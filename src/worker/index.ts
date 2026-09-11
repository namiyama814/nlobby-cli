import OAuthProvider, { type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { createNLobbyRemoteMcp } from "./mcp.js";
import type { Env } from "./types.js";

type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const apiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return createMcpHandler(() => createNLobbyRemoteMcp(env), {
      route: "/mcp",
      corsOptions: false,
    })(request, env, ctx);
  },
};

const authHandler: ExportedHandler<OAuthEnv> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (url.pathname === "/authorize") return beginGithubAuthorization(request, env);
    if (url.pathname === "/callback") return finishGithubAuthorization(request, env);
    return new Response("Not found", { status: 404 });
  },
};

async function beginGithubAuthorization(request: Request, env: OAuthEnv): Promise<Response> {
  const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  if (!authRequest.clientId) return new Response("Invalid OAuth client", { status: 400 });
  const state = crypto.randomUUID();
  await env.OAUTH_KV.put(`github-state:${state}`, JSON.stringify(authRequest), { expirationTtl: 600 });
  const callback = new URL("/callback", request.url).href;
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", callback);
  github.searchParams.set("scope", "read:user");
  github.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: github.href,
      "Set-Cookie": `__Host-nlobby-oauth-state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}

async function finishGithubAuthorization(request: Request, env: OAuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code || readCookie(request, "__Host-nlobby-oauth-state") !== state) {
    return new Response("Invalid OAuth state", { status: 400 });
  }
  const stored = await env.OAUTH_KV.get(`github-state:${state}`);
  await env.OAUTH_KV.delete(`github-state:${state}`);
  if (!stored) return new Response("OAuth state expired", { status: 400 });
  const authRequest = JSON.parse(stored);
  const callback = new URL("/callback", request.url).href;
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback }),
  });
  const token = (await tokenResponse.json() as { access_token?: string }).access_token;
  if (!token) return new Response("GitHub authentication failed", { status: 401 });
  const userResponse = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "nlobby-cli-worker" } });
  const user = await userResponse.json() as { login?: string };
  if (!user.login || user.login.toLowerCase() !== env.ALLOWED_GITHUB_LOGIN.toLowerCase()) {
    return new Response("This GitHub account is not allowed to access this MCP server.", { status: 403 });
  }
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: user.login,
    scope: authRequest.scope,
    props: { login: user.login },
  });
  return new Response(null, { status: 302, headers: { Location: redirectTo, "Set-Cookie": "__Host-nlobby-oauth-state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" } });
}

function readCookie(request: Request, name: string): string | undefined {
  return request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export default new OAuthProvider<OAuthEnv>({
  apiRoute: "/mcp",
  apiHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  defaultHandler: authHandler,
  scopesSupported: ["nlobby.read"],
});
