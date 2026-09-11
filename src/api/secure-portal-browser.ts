import type { CookieParam } from "puppeteer";
import { CONFIG } from "../config.js";
import type { SecurePortalCookie } from "./secure-portal.js";

export function buildPuppeteerCookies(
  cookieHeader: string,
  domain: string,
): CookieParam[] {
  const cookies: CookieParam[] = [];
  for (const rawPart of cookieHeader.split(";")) {
    const part = rawPart.trim();
    const separatorIndex = part.indexOf("=");
    if (!part || separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex);
    cookies.push({
      name,
      value: part.slice(separatorIndex + 1),
      domain,
      path: "/",
      secure: true,
      httpOnly: name.startsWith("__Secure-") || name.startsWith("__Host-") || name.toLowerCase().includes("session"),
      sameSite: "Lax",
    });
  }
  return cookies;
}

export async function captureSecurePortalElement(options: {
  startUrl: string;
  cookies: CookieParam[] | SecurePortalCookie[];
  waitForSelector: string;
  screenshotName: string;
}): Promise<{ base64: string; path: string; finalUrl: string; elementSize?: { width: number; height: number } }> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { launchPuppeteerBrowser } = await import("../auth/puppeteer-launch.js");
  const browser = await launchPuppeteerBrowser({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(CONFIG.userAgent);
    await page.setCookie(...(options.cookies as CookieParam[]));
    await page.goto(options.startUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(options.waitForSelector, { timeout: 60000 });
    const elementHandle = await page.$(options.waitForSelector);
    if (!elementHandle) throw new Error(`Failed to locate element ${options.waitForSelector} for screenshot`);
    const buffer = (await elementHandle.screenshot({ type: "png" })) as Buffer;
    const tmpDir = path.join(os.tmpdir(), "nlobby-student-card");
    await fs.mkdir(tmpDir, { recursive: true });
    const screenshotPath = path.join(tmpDir, options.screenshotName);
    await fs.writeFile(screenshotPath, buffer);
    const box = await elementHandle.boundingBox();
    return { base64: buffer.toString("base64"), path: screenshotPath, finalUrl: page.url(), elementSize: box ? { width: Math.round(box.width), height: Math.round(box.height) } : undefined };
  } finally {
    await browser.close();
  }
}
