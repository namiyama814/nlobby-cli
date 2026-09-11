import puppeteer from "@cloudflare/puppeteer";
import { getAccountInfoFromScript } from "../api/account.js";
import {
  buildSecurePortalCallbackUrl,
  buildSecurePortalCookies,
  resolveSecureHostFromStudentNo,
} from "../api/secure-portal.js";
import type { RemoteNLobbyApi } from "./api.js";
import type { Env } from "./types.js";

const DOWNLOAD_TTL_SECONDS = 10 * 60;

interface DownloadRecord {
  key: string;
  filename: string;
  expiresAt: number;
}

function createDownloadToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createStudentCardDownload(
  env: Env,
  api: RemoteNLobbyApi,
): Promise<{ downloadUrl: string; expiresAt: string; filename: string }> {
  const account = await getAccountInfoFromScript(api);
  if (!account.studentNo || account.studentNo.length < 3) {
    throw new Error("Student number is missing from account information.");
  }
  const cookieHeader = api.httpClient.defaults.headers.Cookie;
  if (!cookieHeader || typeof cookieHeader !== "string") {
    throw new Error("N Lobby authentication cookies are not configured.");
  }

  const secureHost = resolveSecureHostFromStudentNo(account.studentNo);
  const { callbackUrl } = buildSecurePortalCallbackUrl(
    secureHost,
    "/mypage/student_card/index",
  );
  const browser = await puppeteer.launch(env.BROWSER);
  let png: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setCookie(
      ...(buildSecurePortalCookies(cookieHeader, "nlobby.nnn.ed.jp") as never[]),
    );
    await page.goto(callbackUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await page.waitForSelector("#main", { timeout: 60_000 });
    const main = await page.$("#main");
    if (!main) throw new Error("Student card page did not contain its main content.");
    png = (await main.screenshot({ type: "png" })) as unknown as Uint8Array;
  } finally {
    await browser.close();
  }

  const token = createDownloadToken();
  const expiresAt = Date.now() + DOWNLOAD_TTL_SECONDS * 1000;
  const key = `student-card/${expiresAt}-${token}.png`;
  const filename = "nlobby-student-card.png";
  await env.SCREENSHOTS.put(key, png, {
    httpMetadata: {
      contentType: "image/png",
      contentDisposition: `attachment; filename="${filename}"`,
      cacheControl: "no-store",
    },
    customMetadata: { expiresAt: String(expiresAt) },
  });
  const record: DownloadRecord = { key, filename, expiresAt };
  await env.NLOBBY_DOWNLOADS.put(`download:${token}`, JSON.stringify(record), {
    expirationTtl: DOWNLOAD_TTL_SECONDS,
  });
  return {
    downloadUrl: `${env.DOWNLOAD_BASE_URL}/download/${token}`,
    expiresAt: new Date(expiresAt).toISOString(),
    filename,
  };
}

export async function serveDownload(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const token = new URL(request.url).pathname.split("/").at(-1) ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Not found", { status: 404 });
  const stored = await env.NLOBBY_DOWNLOADS.get(`download:${token}`);
  if (!stored) return new Response("This download link has expired.", { status: 410 });
  let record: DownloadRecord;
  try { record = JSON.parse(stored) as DownloadRecord; } catch { return new Response("Not found", { status: 404 }); }
  if (record.expiresAt <= Date.now()) {
    await Promise.all([env.NLOBBY_DOWNLOADS.delete(`download:${token}`), env.SCREENSHOTS.delete(record.key)]);
    return new Response("This download link has expired.", { status: 410 });
  }
  const object = await env.SCREENSHOTS.get(record.key);
  if (!object || !object.body) return new Response("This download link has expired.", { status: 410 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "image/png");
  headers.set("Content-Disposition", `attachment; filename="${record.filename}"`);
  headers.set("Cache-Control", "no-store, private");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

/** Deletes screenshots that reached their 10-minute expiry. The cron is a
 * fallback for links that were never opened. */
export async function cleanupExpiredScreenshots(env: Env): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.SCREENSHOTS.list({ prefix: "student-card/", cursor });
    const expired = listed.objects.filter((object) => {
      const expiresAt = Number(object.customMetadata?.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    });
    await Promise.all(expired.map((object) => env.SCREENSHOTS.delete(object.key)));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
