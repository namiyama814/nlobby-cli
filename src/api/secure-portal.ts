import { CONFIG } from "../config.js";
import type { ApiContext } from "./context.js";
import { getAccountInfoFromScript } from "./account.js";

/** A transport-neutral cookie shape. Keeping this independent of Puppeteer is
 * what lets the Secure Portal flow run in a Cloudflare Worker. */
export interface SecurePortalCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Lax";
}

export function resolveSecureHostFromStudentNo(studentNo: string): string {
  const identifier = studentNo.charAt(2)?.toUpperCase();
  if (!identifier) {
    return "secure.nnn.ed.jp";
  }

  if (identifier === "N") {
    return "secure.nnn.ed.jp";
  }

  if (!/[A-Z]/.test(identifier)) {
    return "secure.nnn.ed.jp";
  }

  return `${identifier.toLowerCase()}-secure.nnn.ed.jp`;
}

export function buildSecurePortalCallbackUrl(
  secureHost: string,
  portalPath: string,
): { targetUrl: string; callbackUrl: string } {
  const normalizedPath = portalPath.startsWith("/")
    ? portalPath
    : `/${portalPath}`;
  const targetUrl = `https://${secureHost}${normalizedPath}`;
  const callbackUrl = `https://nlobby.nnn.ed.jp/mypage/v1/callback?redirect_uri=${encodeURIComponent(targetUrl)}`;
  return { targetUrl, callbackUrl };
}

export function buildSecurePortalCookies(
  cookieHeader: string,
  domain: string,
): SecurePortalCookie[] {
  const cookies: SecurePortalCookie[] = [];

  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim();
    if (!part) continue;

    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;

    const name = part.slice(0, separatorIndex);
    const value = part.slice(separatorIndex + 1);

    cookies.push({
      name,
      value,
      domain,
      path: "/",
      secure: true,
      httpOnly:
        name.startsWith("__Secure-") ||
        name.startsWith("__Host-") ||
        name.toLowerCase().includes("session"),
      sameSite: "Lax",
    });
  }

  return cookies;
}

export async function resolveSecurePortalContext(
  ctx: ApiContext,
  portalPath: string,
): Promise<{
  studentNo: string;
  secureHost: string;
  callbackUrl: string;
  targetUrl: string;
  cookies: SecurePortalCookie[];
}> {
  const accountInfo = await getAccountInfoFromScript(ctx, "/");
  const studentNo = accountInfo.studentNo;

  if (!studentNo || studentNo.length < 3) {
    throw new Error(
      "Student number is missing from account information. Ensure you are authenticated and try again.",
    );
  }

  const secureHost = resolveSecureHostFromStudentNo(studentNo);
  const { targetUrl, callbackUrl } = buildSecurePortalCallbackUrl(
    secureHost,
    portalPath,
  );

  const cookieHeader = ctx.httpClient.defaults.headers["Cookie"];
  if (!cookieHeader || typeof cookieHeader !== "string") {
    throw new Error(
      "Authentication cookies are not set. Use nlobby login or nlobby cookies set first.",
    );
  }

  const cookies = buildSecurePortalCookies(cookieHeader, "nlobby.nnn.ed.jp");
  if (cookies.length === 0) {
    throw new Error(
      "Failed to parse authentication cookies for browser session.",
    );
  }

  return { studentNo, secureHost, callbackUrl, targetUrl, cookies };
}

export async function fetchSecurePortalPage(options: {
  startUrl: string;
  cookies: SecurePortalCookie[];
  waitForSelector?: string;
}): Promise<{ html: string; mainHtml: string; finalUrl: string }> {
  return fetchSecurePortalPageHttp(options);
}

/** Worker-safe secure portal fetch. It follows the existing callback flow and
 * carries Set-Cookie values across redirects without requiring a browser. */
async function fetchSecurePortalPageHttp(options: {
  startUrl: string;
  cookies: SecurePortalCookie[];
  waitForSelector?: string;
}): Promise<{ html: string; mainHtml: string; finalUrl: string }> {
  const jar = new Map(options.cookies.map((cookie) => [cookie.name, cookie.value]));
  let url = options.startUrl;
  for (let redirects = 0; redirects < 8; redirects++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        Cookie: Array.from(jar, ([name, value]) => `${name}=${value}`).join("; "),
        "User-Agent": CONFIG.userAgent,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const values = getSetCookie ? getSetCookie.call(response.headers) : [response.headers.get("set-cookie") ?? ""];
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const equals = pair.indexOf("=");
      if (equals > 0) jar.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Secure Portal redirect did not include a location.");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new Error(`Secure Portal request failed (${response.status}).`);
    const html = await response.text();
    if (/\b(login|sign-in|ログイン)\b/i.test(html) && !/id=["']main["']/i.test(html)) {
      throw new Error("Authentication expired. Please re-authenticate.");
    }
    // Parsers use Cheerio and locate #main themselves. Returning the complete
    // document avoids truncating nested HTML with a regex.
    return { html, mainHtml: html, finalUrl: url };
  }
  throw new Error("Secure Portal redirect limit exceeded.");
}
