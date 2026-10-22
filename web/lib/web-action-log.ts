// The person's action log: what the site asked on their behalf (table
// `web_action_log`, readable by its owner and written only by the database
// function that records a request). The web page and the desktop's agents panel
// read it the same way and say it in the same words, so the reading, the clean-up
// of the rows and the sentence for a row live here, once.
//
// The log is DATA, not UI state: its text fields come from requests the site
// accepted, so every one is cleaned and clipped before it is shown, a code this
// file does not know is shown as such and never trusted, and nothing here reads
// a column that could hold a secret (the owner and the session stay in the
// database).
import type { Locale } from "@/i18n/config";
import { WEB_ACTION_LOG_TEXT } from "@/lib/web-action-log.i18n";

/**
 * The vocabulary of actions the log names: the rows of web_door.vocab that the migrations insert (098 had them
 * in a CHECK, 099 made them data). A row with another code, from a later migration, is kept as «other action».
 */
export const WEB_ACTION_CODES = [
  "team.start",
  "team.stop",
  "team.restart",
  "team.emergency_stop",
  "position.apply_authorize",
  "position.apply_revoke",
  "settings.update",
  "exclusion.decide",
  "exclusion.withdraw",
  "exclusion.profile_set",
  "directive.create",
  "directive.update",
  "directive.archive",
] as const;
export type WebActionCode = (typeof WEB_ACTION_CODES)[number];

export const WEB_ACTION_STATUSES = [
  "awaiting_confirm",
  "queued",
  "done",
  "error",
  "cancelled",
  "expired",
] as const;
export type WebActionStatus = (typeof WEB_ACTION_STATUSES)[number];

export type WebActionLevel = "L1" | "L2" | "L3";

/** How a status reads at a glance: the colour is never the only sign, the word is always there. */
export type WebActionTone = "good" | "bad" | "wait" | "neutral";

/**
 * The columns the page reads: the one place that names the table's columns, so
 * the schema and the screen meet here and nowhere else. No `user_id`, no
 * `session_id`: the owner is the viewer, and a session is not for the eye.
 */
export const WEB_ACTION_LOG_TABLE = "web_action_log";
export const WEB_ACTION_LOG_COLUMNS =
  "id, action, level, params, summary, status, created_at, expires_at, confirmed_at, result";

/** How many rows one read brings, newest first. */
export const WEB_ACTION_LOG_LIMIT = 100;

const SUMMARY_MAX = 200;
const TARGET_MAX = 64;
const RESULT_MAX = 200;
const CODE_MAX = 64;

export type WebActionRow = {
  id: string;
  /** The code as the log wrote it: a known one or not. */
  action: string;
  target: string | null;
  /** The settings a settings action changed, by key, in the order the vocabulary knows them. */
  settings: WebActionSetting[];
  /** The number an action is about, from its params: a position (legacy_id) or a standing order (id). */
  ref: number | null;
  /** The kind of a new standing order, when the action names one. */
  directiveKind: WebActionDirectiveKind | null;
  summary: string;
  level: WebActionLevel | null;
  status: WebActionStatus | null;
  /** ISO time, from the database's own clock. */
  createdAt: string;
  /** Until when a request that waits for the person's confirmation can be confirmed. */
  expiresAt: string | null;
  confirmedAt: string | null;
  result: string | null;
};

/** Controls, line and paragraph separators, zero-width and bidirectional marks: nothing the eye should not see. */
function hiddenCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** One line of plain text, at most `max` characters; empty when there is nothing readable. */
export function cleanLogText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const char of value)
    out += hiddenCharacter(char.codePointAt(0) ?? 0) ? " " : char;
  out = out.replace(/ {2,}/g, " ").trim();
  const chars = Array.from(out);
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : out;
}

function isoTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function level(value: unknown): WebActionLevel | null {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  if (text === "L1" || text === "L2" || text === "L3") return text;
  return text === "1" || text === "2" || text === "3"
    ? (`L${text}` as WebActionLevel)
    : null;
}

/** The agent a team action is about, when the action names one: `params.target`, a role or «all». */
function paramsTarget(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  return (
    cleanLogText((params as Record<string, unknown>).target, TARGET_MAX) || null
  );
}

/** The settings keys the site may change (migration 100), in the order they are named. */
export const WEB_ACTION_SETTINGS = ["working_hours", "role_models"] as const;
export type WebActionSetting = (typeof WEB_ACTION_SETTINGS)[number];

/** The kinds of standing order the board knows (team_directives.kind). */
export const WEB_ACTION_DIRECTIVE_KINDS = [
  "order",
  "strategy",
  "formation",
  "note",
] as const;
export type WebActionDirectiveKind =
  (typeof WEB_ACTION_DIRECTIVE_KINDS)[number];

function paramsRef(params: unknown): number | null {
  if (!params || typeof params !== "object" || Array.isArray(params))
    return null;
  const record = params as Record<string, unknown>;
  const value = record.legacy_id ?? record.id;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function paramsDirectiveKind(params: unknown): WebActionDirectiveKind | null {
  if (!params || typeof params !== "object" || Array.isArray(params))
    return null;
  const kind = (params as Record<string, unknown>).kind;
  return (WEB_ACTION_DIRECTIVE_KINDS as readonly unknown[]).includes(kind)
    ? (kind as WebActionDirectiveKind)
    : null;
}

function paramsSettings(params: unknown): WebActionSetting[] {
  if (!params || typeof params !== "object" || Array.isArray(params)) return [];
  return WEB_ACTION_SETTINGS.filter((key) =>
    Object.prototype.hasOwnProperty.call(params, key),
  );
}

/** One row of the table, or null when it has no id, no action or no time (it cannot be placed in a list). */
export function parseWebActionRow(raw: unknown): WebActionRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id =
    typeof row.id === "string" || typeof row.id === "number"
      ? String(row.id).trim()
      : "";
  const action = cleanLogText(row.action, CODE_MAX);
  const createdAt = isoTime(row.created_at);
  if (!id || !action || !createdAt) return null;
  const status = (WEB_ACTION_STATUSES as readonly string[]).includes(
    String(row.status),
  )
    ? (row.status as WebActionStatus)
    : null;
  return {
    id,
    action,
    target: paramsTarget(row.params),
    settings: paramsSettings(row.params),
    ref: paramsRef(row.params),
    directiveKind: paramsDirectiveKind(row.params),
    summary: cleanLogText(row.summary, SUMMARY_MAX),
    level: level(row.level),
    status,
    createdAt,
    expiresAt: isoTime(row.expires_at),
    confirmedAt: isoTime(row.confirmed_at),
    result: cleanLogText(row.result, RESULT_MAX) || null,
  };
}

/** The rows a read brought, the ones that cannot be placed dropped, newest first. */
export function parseWebActionRows(raw: unknown): WebActionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseWebActionRow)
    .filter((row): row is WebActionRow => row !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isKnownAction(code: string): code is WebActionCode {
  return (WEB_ACTION_CODES as readonly string[]).includes(code);
}

export function actionTitle(row: WebActionRow, locale: Locale): string {
  const text = WEB_ACTION_LOG_TEXT[locale] ?? WEB_ACTION_LOG_TEXT.en;
  return isKnownAction(row.action)
    ? text.action[row.action]
    : text.unknownAction.replace("{code}", row.action);
}

/**
 * What names the thing an action is about: for a team action the agent or the whole team, for a settings
 * action what it changed, in the person's language (the summary of both is a machine phrase in English,
 * never shown); for an application the summary is the position («title @ company»).
 */
export function actionSubject(
  row: WebActionRow,
  locale: Locale,
): string | null {
  const text = WEB_ACTION_LOG_TEXT[locale] ?? WEB_ACTION_LOG_TEXT.en;
  if (row.action.startsWith("team.")) {
    // The emergency stop takes no target: it is always the whole team.
    if (row.action === "team.emergency_stop") return text.targetAll;
    if (!row.target) return null;
    return row.target.toLowerCase() === "all" ? text.targetAll : row.target;
  }
  if (row.action.startsWith("settings.")) {
    return row.settings.length
      ? row.settings.map((key) => text.setting[key]).join(", ")
      : null;
  }
  // Exclusions and standing orders are named by their number (and a new order by its kind): their
  // summary is a machine phrase, and an order's carries the start of its text, never shown here.
  if (row.action.startsWith("exclusion.")) {
    return row.ref ? text.positionRef.replace("{n}", String(row.ref)) : null;
  }
  if (row.action.startsWith("directive.")) {
    if (row.ref) return text.directiveRef.replace("{n}", String(row.ref));
    return row.directiveKind ? text.directiveKind[row.directiveKind] : null;
  }
  return row.summary || null;
}

export function statusLabel(row: WebActionRow, locale: Locale): string {
  const text = WEB_ACTION_LOG_TEXT[locale] ?? WEB_ACTION_LOG_TEXT.en;
  return row.status ? text.status[row.status] : text.unknownStatus;
}

export function statusTone(status: WebActionStatus | null): WebActionTone {
  if (status === "done") return "good";
  if (status === "error") return "bad";
  if (status === "awaiting_confirm" || status === "queued") return "wait";
  return "neutral";
}

/** What a read of the log came to: the rows, or why there are none. */
export type WebActionLogRead =
  | { ok: true; rows: WebActionRow[] }
  | { ok: false; reason: "not_active" | "signed_out" | "unavailable" };

/**
 * Structural on purpose: the web's and the desktop's Supabase clients both fit
 * as they are (their generated query types are too deep to compare), and a test
 * passes a fake.
 */
export type WebActionLogClient = {
  from(table: string): any;
};

/** Postgres «undefined table» and PostgREST «not in the schema cache»: the log is not there yet. */
const TABLE_MISSING = new Set(["42P01", "PGRST205"]);
/** Postgres «insufficient privilege» and the JWT failures of PostgREST: nobody is signed in. */
const NOT_SIGNED_IN = new Set(["42501", "PGRST301", "PGRST302"]);

/**
 * The person's own rows, newest first (the owner's policy picks them: no
 * filter on the user is passed, none could widen it). A failure is a reason,
 * never an exception and never the database's message.
 */
export async function readWebActionLog(
  client: WebActionLogClient,
  limit = WEB_ACTION_LOG_LIMIT,
): Promise<WebActionLogRead> {
  try {
    // The table and the columns are written out here, not taken from the constants: the schema coverage check
    // reads this call as it stands. A test pins that they are the constants' own.
    const { data, error } = await client
      .from("web_action_log")
      .select(
        "id, action, level, params, summary, status, created_at, expires_at, confirmed_at, result",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      const code = error.code ?? "";
      if (TABLE_MISSING.has(code)) return { ok: false, reason: "not_active" };
      if (NOT_SIGNED_IN.has(code)) return { ok: false, reason: "signed_out" };
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, rows: parseWebActionRows(data) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
