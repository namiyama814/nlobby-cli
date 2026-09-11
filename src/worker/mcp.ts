import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CalendarType } from "../types.js";
import { RemoteNLobbyApi } from "./api.js";
import { saveUpdatedSession } from "./session-store.js";
import type { Env } from "./types.js";

const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const readOnly = { readOnlyHint: true };

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to retrieve N Lobby data.";
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function createNLobbyRemoteMcp(env: Env): McpServer {
  const api = new RemoteNLobbyApi(env);
  const server = new McpServer({ name: "nlobby-cli", version: "1.6.0" });

  server.registerTool("get_news", {
    description: "Retrieve recent N Lobby school announcements. Use this for unread news, notices, and deadlines.",
    inputSchema: z.object({ category: z.string().optional(), limit: z.number().int().min(1).max(100).default(10), tab: z.enum(["all", "mentor"]).default("all") }), annotations: readOnly,
  }, async ({ category, limit, tab }) => {
    try { const items = await api.getNews({ tab }); return result((category ? items.filter((item) => item.category === category) : items).slice(0, limit)); } catch (e) { return safeError(e); }
  });
  server.registerTool("get_news_detail", {
    description: "Retrieve the content and metadata of one N Lobby announcement. This never marks an announcement as read.",
    inputSchema: z.object({ newsId: z.string().min(1) }), annotations: readOnly,
  }, async ({ newsId }) => { try { return result(await api.getNewsDetail(newsId)); } catch (e) { return safeError(e); } });
  server.registerTool("get_unread_news_info", { description: "Get unread N Lobby announcement counts and important-news flags.", inputSchema: z.object({}), annotations: readOnly }, async () => { try { return result(await api.getUnreadNewsInfo()); } catch (e) { return safeError(e); } });
  server.registerTool("get_schedule", { description: "Get the N Lobby schedule for one date, or today when omitted.", inputSchema: z.object({ date: z.string().optional() }), annotations: readOnly }, async ({ date }) => { try { return result(await api.getScheduleByDate(date)); } catch (e) { return safeError(e); } });
  server.registerTool("get_calendar_events", { description: "Get personal or school calendar events for a date range.", inputSchema: z.object({ calendar_type: z.enum(["personal", "school"]).default("personal"), from_date: z.string().optional(), to_date: z.string().optional() }), annotations: readOnly }, async ({ calendar_type, from_date, to_date }) => {
    try {
      const range = from_date ? { from: new Date(from_date), to: new Date(to_date ?? from_date) } : undefined;
      return result(await api.getSchedule(calendar_type === "school" ? CalendarType.SCHOOL : CalendarType.PERSONAL, range));
    } catch (e) { return safeError(e); }
  });
  server.registerTool("get_calendar_filters", { description: "Get the configured N Lobby calendar filter list.", inputSchema: z.object({}), annotations: readOnly }, async () => { try { return result(await api.getLobbyCalendarFilters()); } catch (e) { return safeError(e); } });
  server.registerTool("get_required_courses", { description: "Retrieve required courses and progress. Optional filters narrow the results.", inputSchema: z.object({ grade: z.number().int().optional(), semester: z.string().optional(), category: z.string().optional() }), annotations: readOnly }, async ({ grade, semester, category }) => {
    try { const courses = await api.getRequiredCourses(); return result(courses.filter((course) => (!grade || course.grade === `${grade}年次`) && (!semester || String(course.termYear ?? "").includes(semester)) && (!category || (course.curriculumName ?? "").includes(category)))); } catch (e) { return safeError(e); }
  });
  server.registerTool("get_learning_resources", { description: "Get N Lobby learning resources, optionally filtered by subject.", inputSchema: z.object({ subject: z.string().optional() }), annotations: readOnly }, async ({ subject }) => { try { return result(await api.getLearningResources(subject)); } catch (e) { return safeError(e); } });
  server.registerTool("get_account_info", { description: "Retrieve the authenticated student's N Lobby account information.", inputSchema: z.object({}), annotations: readOnly }, async () => { try { return result(await api.getAccountInfo()); } catch (e) { return safeError(e); } });
  server.registerTool("get_navigation_menus", { description: "Get the available N Lobby navigation menu.", inputSchema: z.object({}), annotations: readOnly }, async () => { try { return result(await api.getMainNavigations()); } catch (e) { return safeError(e); } });
  server.registerTool("get_notifications", { description: "Get N Lobby notification messages.", inputSchema: z.object({}), annotations: readOnly }, async () => { try { return result(await api.getNotificationMessages()); } catch (e) { return safeError(e); } });
  server.registerTool("get_user_interests", { description: "Get user interest tags from N Lobby.", inputSchema: z.object({ with_icon: z.boolean().default(false) }), annotations: readOnly }, async ({ with_icon }) => { try { return result(await api.getUserInterests(with_icon)); } catch (e) { return safeError(e); } });
  server.registerTool("get_interest_weights", { description: "Get N Lobby interest-weight scale definitions.", inputSchema: z.object({}), annotations: readOnly }, async () => { try { return result(await api.getInterestWeights()); } catch (e) { return safeError(e); } });
  server.registerTool("check_exam_day", { description: "Check whether a date is an N Lobby exam day.", inputSchema: z.object({ date: z.string().optional() }), annotations: readOnly }, async ({ date }) => { try { return result({ date: date ?? new Date().toISOString().slice(0, 10), isExamDay: await api.isExamDay(date ? new Date(date) : undefined) }); } catch (e) { return safeError(e); } });
  server.registerTool("get_schooling", {
    description: "Retrieve the authenticated student's Secure Portal schooling sessions and summary. This only reads data.",
    inputSchema: z.object({}), annotations: readOnly,
  }, async () => { try { return result(await api.getSchooling()); } catch (e) { return safeError(e); } });
  server.registerTool("get_schooling_detail", {
    description: "Retrieve the read-only detail for one Secure Portal schooling session.",
    inputSchema: z.object({ entry_id: z.string().regex(/^\d+$/) }), annotations: readOnly,
  }, async ({ entry_id }) => { try { return result(await api.getSchoolingDetail(entry_id)); } catch (e) { return safeError(e); } });
  server.registerTool("get_designated_school", {
    description: "Search the Secure Portal's designated-school information. This only reads data and does not submit an application.",
    inputSchema: z.object({
      prefectures: z.array(z.number().int()).optional(), school_types: z.array(z.number().int()).optional(),
      school_name: z.string().optional(), school_name_exact: z.boolean().default(false),
      faculty_name: z.string().optional(), faculty_name_exact: z.boolean().default(false),
      freeword: z.string().optional(), freeword_exact: z.boolean().default(false),
      selection_deadline_before: z.string().optional(), page: z.number().int().min(1).optional(),
    }), annotations: readOnly,
  }, async (input) => {
    try {
      return result(await api.getDesignatedSchool({
        prefectures: input.prefectures, schoolTypes: input.school_types,
        schoolName: input.school_name, schoolNameExact: input.school_name_exact,
        facultyName: input.faculty_name, facultyNameExact: input.faculty_name_exact,
        freeword: input.freeword, freewordExact: input.freeword_exact,
        selectionDeadlineBefore: input.selection_deadline_before, page: input.page,
      }));
    } catch (e) { return safeError(e); }
  });
  server.registerTool("update_nlobby_session", {
    description: "Replace the stored N Lobby session token after the user has logged in through their normal browser. This is an authentication update; never call it unless the user explicitly supplies a newly obtained session token.",
    inputSchema: z.object({ session_token: z.string().min(20).describe("New __Secure-next-auth.session-token value from the user's N Lobby browser session") }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ session_token }) => {
    try {
      await saveUpdatedSession(env, session_token);
      return { content: [{ type: "text" as const, text: "N Lobby session updated securely. The new session will be used on the next request." }] };
    } catch (e) { return safeError(e); }
  });
  return server;
}
