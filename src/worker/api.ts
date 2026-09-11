import { NextAuthHandler } from "../auth/nextauth.js";
import { getAccountInfoFromScript } from "../api/account.js";
import { getRequiredCourses, getLearningResources, isExamDay } from "../api/courses.js";
import { getNews, getNewsDetail, getUnreadNewsInfo } from "../api/news.js";
import { getMainNavigations, getNotificationMessages, getUserInterests, getInterestWeights } from "../api/navigation.js";
import { getSchedule, getScheduleByDate, getLobbyCalendarFilters } from "../api/schedule.js";
import { getSchooling, getSchoolingDetail } from "../api/schooling.js";
import { getDesignatedSchool } from "../api/designated-school.js";
import { HttpClient, HttpClientError } from "../http-client.js";
import { TRPCClient } from "../trpc-client.js";
import { CalendarType } from "../types.js";
import { readUpdatedSession } from "./session-store.js";
import type { Env } from "./types.js";

const EXPIRED_MESSAGE = "N Lobby session has expired. Please update the Cloudflare secret.";

export function cookieHeaderFromSecrets(env: Env): string {
  if (env.NLOBBY_COOKIE_HEADER?.trim()) return env.NLOBBY_COOKIE_HEADER.trim();
  if (!env.NLOBBY_SESSION_TOKEN?.trim()) {
    throw new Error("N Lobby session is not configured. Set NLOBBY_SESSION_TOKEN.");
  }
  const parts = [
    `__Secure-next-auth.session-token=${encodeURIComponent(env.NLOBBY_SESSION_TOKEN)}`,
  ];
  if (env.NLOBBY_CSRF_TOKEN?.trim()) {
    parts.push(`__Host-next-auth.csrf-token=${encodeURIComponent(env.NLOBBY_CSRF_TOKEN)}`);
  }
  if (env.NLOBBY_CALLBACK_URL?.trim()) {
    parts.push(`__Secure-next-auth.callback-url=${encodeURIComponent(env.NLOBBY_CALLBACK_URL)}`);
  }
  return parts.join("; ");
}

export class RemoteNLobbyApi {
  readonly httpClient: HttpClient;
  readonly nextAuth: NextAuthHandler;
  readonly trpcClient: TRPCClient;
  private readonly env: Env;
  private activeCookies: string;

  constructor(env: Env) {
    const cookies = cookieHeaderFromSecrets(env);
    this.env = env;
    this.activeCookies = cookies;
    this.nextAuth = new NextAuthHandler();
    this.nextAuth.setCookies(cookies);
    this.httpClient = new HttpClient({
      baseURL: "https://nlobby.nnn.ed.jp",
      timeout: 15_000,
      headers: { "Content-Type": "application/json", "User-Agent": "nlobby-cli-worker/1.6.0" },
    });
    this.httpClient.defaults.headers.Cookie = cookies;
    this.trpcClient = new TRPCClient(this.nextAuth);
    this.trpcClient.setAllCookies(cookies);
  }

  getCookieStatus(): string {
    return this.nextAuth.isAuthenticated() ? "configured" : "missing";
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await this.applyUpdatedSession();
      return await fn();
    } catch (error) {
      if (isAuthenticationFailure(error)) throw new Error(EXPIRED_MESSAGE);
      throw error;
    }
  }

  private async applyUpdatedSession(): Promise<void> {
    const updatedToken = await readUpdatedSession(this.env);
    if (!updatedToken) return;
    const cookies = cookieHeaderFromSecrets({ ...this.env, NLOBBY_COOKIE_HEADER: undefined, NLOBBY_SESSION_TOKEN: updatedToken });
    if (cookies === this.activeCookies) return;
    this.activeCookies = cookies;
    this.httpClient.defaults.headers.Cookie = cookies;
    this.nextAuth.setCookies(cookies);
    this.trpcClient.setAllCookies(cookies);
  }

  getNews = (options?: Parameters<typeof getNews>[1]) => this.call(() => getNews(this, options));
  getNewsDetail = (id: string) => this.call(() => getNewsDetail(this, id));
  getUnreadNewsInfo = () => this.call(() => getUnreadNewsInfo(this));
  getScheduleByDate = (date?: string) => this.call(() => getScheduleByDate(this, date));
  getSchedule = (type: CalendarType, range?: Parameters<typeof getSchedule>[2]) => this.call(() => getSchedule(this, type, range));
  getLobbyCalendarFilters = () => this.call(() => getLobbyCalendarFilters(this));
  getRequiredCourses = () => this.call(() => getRequiredCourses(this));
  getLearningResources = (subject?: string) => this.call(() => getLearningResources(this, subject));
  getAccountInfo = () => this.call(() => getAccountInfoFromScript(this));
  getMainNavigations = () => this.call(() => getMainNavigations(this));
  getNotificationMessages = () => this.call(() => getNotificationMessages(this));
  getUserInterests = (withIcon?: boolean) => this.call(() => getUserInterests(this, withIcon));
  getInterestWeights = () => this.call(() => getInterestWeights(this));
  isExamDay = (date?: Date) => this.call(() => isExamDay(this, date));
  getSchooling = () => this.call(() => getSchooling(this));
  getSchoolingDetail = (entryId: string) => this.call(() => getSchoolingDetail(this, entryId));
  getDesignatedSchool = (options?: Parameters<typeof getDesignatedSchool>[1]) =>
    this.call(() => getDesignatedSchool(this, options));
}

function isAuthenticationFailure(error: unknown): boolean {
  if (error instanceof HttpClientError) return error.response?.status === 401 || error.response?.status === 403;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("authentication expired") || message.includes("unauthorized") || message.includes("login");
}
