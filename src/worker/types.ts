import type { BrowserWorker } from "@cloudflare/puppeteer";

export interface Env {
  OAUTH_KV: KVNamespace;
  NLOBBY_SESSIONS: KVNamespace;
  NLOBBY_DOWNLOADS: KVNamespace;
  SCREENSHOTS: R2Bucket;
  BROWSER: BrowserWorker;
  DOWNLOAD_BASE_URL: string;
  NLOBBY_SESSION_TOKEN: string;
  NLOBBY_CSRF_TOKEN?: string;
  NLOBBY_CALLBACK_URL?: string;
  NLOBBY_COOKIE_HEADER?: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  ALLOWED_GITHUB_LOGIN: string;
}
