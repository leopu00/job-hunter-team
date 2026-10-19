/**
 * `shared/skills/feedback_query.py` as a native tool: the user's
 * like/dislike/hide/star, one position at a time (`check`) or over a window
 * (`recent`, `themes`).
 *
 * Local first, as the script: `check` answers from `position_feedback` in
 * jobs.db. `recent` and `themes` read the cloud aggregate in the script; this
 * runtime has no cloud lane and never reads the cloud token, so without
 * `legacy_ids` they answer with the script's own neutral payload for a cloud
 * that is off (`note: no-signal:cloud-disabled`), and with `legacy_ids` they
 * read each position locally, as the script's fallback does.
 *
 * JHT-T05, **narrower than the old script on purpose and the same as the new
 * one**: the reason of a judgement is a code of the closed vocabulary, and
 * the text the user writes (the note, the old comment) never leaves the
 * database: it is not selected, so no prompt can carry it. `themes` counts
 * distinct positions per code and says nothing else about them.
 */

import { z } from "zod";

import type { Database } from "../../db/jobs-db.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { FEEDBACK_REASON_LABELS, safeReason } from "./feedback-reasons.ts";
import { PyFloat, pyJson, pyParseTs, pyRound3 } from "./py-compat.ts";

export const FEEDBACK_QUERY_TOOL = "feedback_query";
export const NO_SIGNAL_CLOUD_DISABLED = "no-signal:cloud-disabled";
const NO_SIGNAL_NO_READABLE_POSITIONS = "no-signal:no-readable-positions";

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_EVENT_LIMIT = 500;
const ACTION_KINDS = ["like", "dislike", "hide", "star", "clear"] as const;
const MAX_THEME_IDS = 20;

export interface FeedbackQueryOptions {
  /** Opens the team database. The runtime decides which file. */
  db: () => Database;
  /** `$JHT_HOME` as the environment gives it (kept for the caller; no text is displayed any more). */
  jhtHome?: string | undefined;
  now?: () => Date;
}

type Row = Record<string, unknown>;
/** One feedback event, with the keys in the order the script builds them. */
type FeedbackEvent = Record<string, unknown>;

/**
 * A legacy_id as a model writes it: the text of the prompt (`--legacy-id 42`)
 * or the number it stands for.
 */
const legacyId = z.union([z.string().min(1).max(64), z.number().int()]).transform(String);

/**
 * One id or a list of them. The script's flag repeats (`--exclude-legacy-id
 * 12 --exclude-legacy-id 13`) and the SCORER's prompt passes one, so a model
 * copies it as a single value: the live chain of 19/09 sent a string where
 * the tool wanted an array, and lost the call.
 */
const legacyIdList = z
  .union([legacyId, z.array(legacyId).max(200)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

const window_ = {
  days: z.number().int().optional().describe(`window in days (default ${DEFAULT_WINDOW_DAYS}, 0 = all)`),
  limit: z.number().int().optional().describe(`maximum events (default ${DEFAULT_EVENT_LIMIT})`),
  // The script takes "12,13"; a list or a single id reads the same.
  legacy_ids: z
    .union([z.string().max(4_000), z.number().int(), z.array(legacyId).max(200)])
    .transform((value) => (Array.isArray(value) ? value.join(",") : String(value)))
    .optional()
    .describe('legacy_ids read one at a time: "12,13" or ["12", "13"]'),
};

const schema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("check"), legacy_id: legacyId.describe("the position's legacy_id") }).strict(),
  z
    .object({
      command: z.literal("recent"),
      ...window_,
      text_chars: z.number().int().optional().describe("ignored: events carry the reason code only"),
    })
    .strict(),
  z
    .object({
      command: z.literal("themes"),
      ...window_,
      field: z.enum(["reason", "comment", "both"]).optional().describe("ignored: kept for older prompts"),
      min_positions: z.number().int().optional().describe("drop themes below N distinct positions (default 3)"),
      top: z.number().int().optional().describe("keep the top N themes"),
      include_cleared: z.boolean().optional(),
      exclude_legacy_id: legacyIdList.optional().describe('positions left out of the aggregate: "12" or ["12", "13"]'),
    })
    .strict(),
]);
type Args = z.output<typeof schema>;

export function createFeedbackQueryTool(options: FeedbackQueryOptions): ToolHandler {
  const now = options.now ?? (() => new Date());

  /** The judgement events, newest first, or null when the local table cannot answer. */
  const localEvents = (legacyId: string): Row[] | null => {
    if (!/^-?\d+$/.test(legacyId)) return null;
    try {
      const db = options.db();
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='position_feedback'").get();
      if (!table) return null;
      return db
        .prepare(
          "SELECT action, reason, score, direction, created_at FROM position_feedback " +
            "WHERE position_id = ? ORDER BY id DESC",
        )
        .all(Number(legacyId)) as Row[];
    } catch {
      return null;
    }
  };

  const checkPosition = (legacyId: string): FeedbackEvent => {
    const events = localEvents(legacyId);
    if (events === null) {
      return {
        ok: true,
        legacy_id: legacyId,
        latest_action: null,
        latest_direction: null,
        count: 0,
        actions: [],
        note: NO_SIGNAL_CLOUD_DISABLED,
      };
    }
    const actions = events.map((f) => ({
      action: f["action"],
      created_at: f["created_at"] ?? null,
      reason: safeReason(f["reason"]),
      score: f["score"] ?? null,
      direction: f["direction"] ?? null,
    }));
    return {
      ok: true,
      legacy_id: legacyId,
      latest_action: actions[0]?.action ?? null,
      // The most recent direction anywhere in the history, not only on the latest event.
      latest_direction: actions.find((a) => a.direction)?.direction ?? null,
      count: actions.length,
      actions,
      source: "local",
    };
  };

  /** The script's `fetch_events`: events and a no-signal note, never an error. */
  const fetchEvents = (days: number, legacyIds: string[] | null): { events: FeedbackEvent[]; note: string | null } => {
    if (legacyIds && legacyIds.length > 0) {
      const events: FeedbackEvent[] = [];
      let failures = 0;
      for (const lid of legacyIds) {
        const payload = checkPosition(lid);
        if (payload["note"]) {
          failures += 1;
          continue;
        }
        for (const action of payload["actions"] as FeedbackEvent[]) events.push({ ...action, legacy_id: lid });
      }
      if (failures > 0 && failures === legacyIds.length) return { events: [], note: NO_SIGNAL_NO_READABLE_POSITIONS };
      return { events: withinWindow(sortedDesc(events), days, now()), note: null };
    }
    // The aggregate endpoint is the cloud's; this runtime has no cloud lane.
    return { events: [], note: NO_SIGNAL_CLOUD_DISABLED };
  };

  const recent = (days: number, limit: number, legacyIds: string[] | null) => {
    const { events, note } = fetchEvents(days, legacyIds);
    const byAction = countBy(events.map((e) => e["action"]).filter(Boolean) as string[]);
    const items = events.slice(0, Math.max(0, limit)).map((e) => ({ ...e }));
    const out: FeedbackEvent = {
      ok: true,
      window_days: days,
      count: events.length,
      positions: new Set(events.map((e) => e["legacy_id"]).filter(Boolean)).size,
      with_reason: events.filter((e) => e["reason"]).length,
      by_action: inActionOrder(byAction),
      items,
    };
    if (note) out["note"] = note;
    return out;
  };

  const themes = (args: Extract<Args, { command: "themes" }>, legacyIds: string[] | null) => {
    const days = args.days ?? DEFAULT_WINDOW_DAYS;
    const fetched = fetchEvents(days, legacyIds);
    const excluded = new Set((args.exclude_legacy_id ?? []).map(String));
    const events = excluded.size > 0 ? fetched.events.filter((e) => !excluded.has(String(e["legacy_id"]))) : fetched.events;
    const out: FeedbackEvent = { ok: true, window_days: days };
    // An attestation for callers that must show the current position's own feedback did not score itself.
    if (excluded.size > 0) out["excluded_legacy_ids"] = [...excluded].sort(pyCompare);
    Object.assign(out, aggregateThemes(events, args.min_positions ?? 3, args.include_cleared ?? false, args.top ?? null));
    if (fetched.note) out["note"] = fetched.note;
    return out;
  };

  return {
    spec: {
      name: FEEDBACK_QUERY_TOOL,
      description:
        "The user's feedback on positions (replaces `python3 …/feedback_query.py`), as JSON. " +
        "check: one position (legacy_id). recent: every event in a window. themes: the reason codes, counted over distinct " +
        "positions (days, min_positions, top, include_cleared, exclude_legacy_id). A `note` of no-signal:* means no data, " +
        "not no feedback. The reason is a code of a closed list; the user's own words are never part of the answer.",
      schema,
    },

    classify(args) {
      const a = args as Args;
      return { risk: "read", paths: [], summary: `feedback_query ${a.command}${a.command === "check" ? ` ${a.legacy_id}` : ""}` };
    },

    async execute(args) {
      const a = args as Args;
      let result: FeedbackEvent;
      try {
        if (a.command === "check") {
          result = checkPosition(a.legacy_id);
        } else {
          const ids = a.legacy_ids ? a.legacy_ids.split(",").map((s) => s.trim()).filter(Boolean) : null;
          result =
            a.command === "recent"
              ? recent(a.days ?? DEFAULT_WINDOW_DAYS, a.limit ?? DEFAULT_EVENT_LIMIT, ids)
              : themes(a, ids);
        }
      } catch {
        // The script's own answer to anything unexpected: a closed code, never the exception's text.
        result = { ok: false, error: "feedback-query-failed" };
      }
      return { ok: result["ok"] === true, content: pyJson(result, { ensureAscii: false }) };
    },
  };
}

/** Events from the most recent; unreadable timestamps last; ties keep their order. */
function sortedDesc(events: FeedbackEvent[]): FeedbackEvent[] {
  const ts = (e: FeedbackEvent) => pyParseTs(e["created_at"]) ?? Number.NEGATIVE_INFINITY;
  return [...events].sort((a, b) => (ts(b) > ts(a) ? 1 : ts(b) < ts(a) ? -1 : 0));
}

/** The window, filtered here too; an event with an unreadable time is kept. */
function withinWindow(events: FeedbackEvent[], days: number, now: Date): FeedbackEvent[] {
  if (!days || days <= 0) return events;
  const cutoff = now.getTime() - days * 86_400_000;
  return events.filter((e) => {
    const t = pyParseTs(e["created_at"]);
    return t === null || t >= cutoff;
  });
}

/** Reason codes, counted over distinct positions; only each position's last judgement counts. */
function aggregateThemes(events: FeedbackEvent[], minPositions: number, includeCleared: boolean, top: number | null): FeedbackEvent {
  const desc = sortedDesc(events);
  const latest = new Map<string, FeedbackEvent>();
  for (const e of desc) {
    const lid = e["legacy_id"];
    if (lid && !latest.has(String(lid))) latest.set(String(lid), e);
  }
  const cleared = new Set([...latest].filter(([, e]) => e["action"] === "clear").map(([lid]) => lid));
  const considered = desc.filter((e) => e["legacy_id"] && (includeCleared || !cleared.has(String(e["legacy_id"]))));
  const lastOf = new Map<string, FeedbackEvent>();
  for (const e of considered) if (!lastOf.has(String(e["legacy_id"]))) lastOf.set(String(e["legacy_id"]), e);
  const withReason = [...lastOf].filter(([, e]) => safeReason(e["reason"]));

  const themes = new Map<string, { positions: Set<string>; actions: string[] }>();
  for (const [lid, e] of withReason) {
    const code = safeReason(e["reason"]) as string;
    const th = themes.get(code) ?? { positions: new Set<string>(), actions: [] };
    th.positions.add(lid);
    if (e["action"]) th.actions.push(String(e["action"]));
    themes.set(code, th);
  }
  const denom = withReason.length || 1;
  let rows = [...themes]
    .filter(([, th]) => th.positions.size >= minPositions)
    .map(([code, th]) => ({
      key: code,
      label: FEEDBACK_REASON_LABELS[code] ?? code,
      positions: th.positions.size,
      events: th.positions.size,
      share: new PyFloat(pyRound3(th.positions.size / denom)),
      // The script sorts these by name, where `by_action` follows the kinds' order.
      actions: Object.fromEntries([...countBy(th.actions)].sort(([a], [b]) => pyCompare(a, b))),
      legacy_ids: [...th.positions].sort(pyCompare).slice(0, MAX_THEME_IDS),
    }))
    .sort((a, b) => b.positions - a.positions || pyCompare(a.key, b.key));
  if (top) rows = rows.slice(0, top);
  return {
    events_total: considered.length,
    events_with_reason: considered.filter((e) => safeReason(e["reason"])).length,
    positions_with_reason: withReason.length,
    positions_cleared: cleared.size,
    by_action: inActionOrder(countBy(considered.map((e) => e["action"]).filter(Boolean) as string[])),
    min_positions: minPositions,
    themes: rows,
  };
}

function countBy(values: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

/** `{k: n for k in ACTION_KINDS if n}`: the known actions, in the script's order. */
function inActionOrder(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries(ACTION_KINDS.filter((k) => counts.get(k)).map((k) => [k, counts.get(k)!]));
}

/** Python's string order: by code point. */
function pyCompare(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
