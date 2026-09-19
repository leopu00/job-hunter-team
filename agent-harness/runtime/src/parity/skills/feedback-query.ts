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
 * read each position locally, as the script's fallback does. The grouping of
 * `themes` is the script's, rule for rule: service words and weak words from
 * its own lists, words cut to five letters, adjacent pairs, counts by
 * distinct positions, a pair absorbing a word it covers at 80 %.
 *
 * `reason` and `comment` are raw: only the `display_*` fields, labels and
 * examples, sanitised as the script does, may reach the user.
 */

import { z } from "zod";

import type { Database } from "../../db/jobs-db.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { DISPLAY_TEXT_MAX_CHARS, sanitizeFeedbackDisplay } from "./feedback-display.ts";
import { PyFloat, pyJson, pyParseTs, pyRound3, pyTruncate } from "./py-compat.ts";

export const FEEDBACK_QUERY_TOOL = "feedback_query";
export const NO_SIGNAL_CLOUD_DISABLED = "no-signal:cloud-disabled";
const NO_SIGNAL_NO_READABLE_POSITIONS = "no-signal:no-readable-positions";

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_EVENT_LIMIT = 500;
const DEFAULT_TEXT_CHARS = 300;
const ACTION_KINDS = ["like", "dislike", "hide", "star", "clear"] as const;
const PREFIX_LEN = 5;
const MIN_TOKEN_LEN = 3;
const BIGRAM_ABSORB_RATIO = 0.8;
const MAX_EXAMPLES = 3;
const EXAMPLE_MAX_CHARS = 160;
const MAX_THEME_IDS = 20;

/** The script's STOPWORDS, verbatim: service words in the product's seven languages. */
const STOPWORDS = new Set(
  (
    "che chi cui con per del dello della delle degli dei dal dalla dalle dai nel nella nelle negli " +
    "nei sul sulla sulle sui una uno gli sono essere stato stata hanno avere questo questa questi " +
    "queste come anche tutto tutti tutte alla allo agli però quindi ecco the and for with that this " +
    "these those from are was were have has had you your they their its into than then there here " +
    "been being will would can could about just what when which while que con para por del los las " +
    "una unos unas este esta estos estas como pero son ser tiene tienen hay cuando porque qui avec " +
    "pour des les une dans sur cette ces est sont etre etait comme quand parce der die das den dem " +
    "und mit fur von ist sind ein eine einen einem einer aber auch wie als bei auf dass sie ich wenn " +
    "weil dos das uma umas uns este esta como sao tem quando porque hogy egy meg mint csak van vannak " +
    "ezt ezek itt ott mert amikor"
  ).split(" "),
);

/** The script's WEAK_ALONE, verbatim: words that mean something only inside a bigram. */
const WEAK_ALONE = new Set(
  (
    "troppo troppa troppi troppe molto molta molti molte poco poca pochi poche piu meno mai sempre " +
    "solo ancora gia too very much little less more only never always still already demasiado demasiada " +
    "muy mucho mucha poco nunca siempre solo mas trop tres beaucoup peu moins plus jamais toujours " +
    "seulement sehr viel wenig mehr weniger nie immer nur schon nicht kein keine muito muita pouco " +
    "pouca mais menos nunca sempre apenas nao nagyon tul keves tobb kevesbe soha mindig csupan nem " +
    "non not pas"
  ).split(" "),
);

export interface FeedbackQueryOptions {
  /** Opens the team database. The runtime decides which file. */
  db: () => Database;
  /** `$JHT_HOME` as the environment gives it: the sanitiser hides it in displayed text. */
  jhtHome?: string | undefined;
  now?: () => Date;
}

type Row = Record<string, unknown>;
/** One feedback event, with the keys in the order the script builds them. */
type FeedbackEvent = Record<string, unknown>;

const window_ = {
  days: z.number().int().optional().describe(`window in days (default ${DEFAULT_WINDOW_DAYS}, 0 = all)`),
  limit: z.number().int().optional().describe(`maximum events (default ${DEFAULT_EVENT_LIMIT})`),
  legacy_ids: z.string().max(4_000).optional().describe('comma-separated legacy_ids, read one at a time: "12,13"'),
};

const schema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("check"), legacy_id: z.string().min(1).max(64).describe("the position's legacy_id") }).strict(),
  z
    .object({
      command: z.literal("recent"),
      ...window_,
      text_chars: z.number().int().optional().describe(`cut reason/comment (default ${DEFAULT_TEXT_CHARS}, 0 = full)`),
    })
    .strict(),
  z
    .object({
      command: z.literal("themes"),
      ...window_,
      field: z.enum(["reason", "comment", "both"]).optional(),
      min_positions: z.number().int().optional().describe("drop themes below N distinct positions (default 3)"),
      top: z.number().int().optional().describe("keep the top N themes"),
      include_cleared: z.boolean().optional(),
      exclude_legacy_id: z.array(z.string().min(1).max(64)).max(200).optional().describe("positions left out of the aggregate"),
    })
    .strict(),
]);
type Args = z.infer<typeof schema>;

export function createFeedbackQueryTool(options: FeedbackQueryOptions): ToolHandler {
  const now = options.now ?? (() => new Date());
  const display = (value: unknown, maxChars?: number) =>
    sanitizeFeedbackDisplay(value, { jhtHome: options.jhtHome, ...(maxChars === undefined ? {} : { maxChars }) });

  /** The judgement events, newest first, or null when the local table cannot answer. */
  const localEvents = (legacyId: string): Row[] | null => {
    if (!/^-?\d+$/.test(legacyId)) return null;
    try {
      const db = options.db();
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='position_feedback'").get();
      if (!table) return null;
      return db
        .prepare(
          "SELECT action, reason, comment, score, direction, created_at FROM position_feedback " +
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
      reason: f["reason"] ?? null,
      comment: f["comment"] ?? null,
      display_reason: display(f["reason"]),
      display_comment: display(f["comment"]),
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

  const recent = (days: number, limit: number, textChars: number, legacyIds: string[] | null) => {
    const { events, note } = fetchEvents(days, legacyIds);
    const byAction = countBy(events.map((e) => e["action"]).filter(Boolean) as string[]);
    const displayChars = textChars > 0 ? Math.min(textChars, DISPLAY_TEXT_MAX_CHARS) : DISPLAY_TEXT_MAX_CHARS;
    const items = events.slice(0, Math.max(0, limit)).map((e) => {
      const item: FeedbackEvent = { ...e };
      item["reason"] = pyTruncate(item["reason"], textChars);
      item["comment"] = pyTruncate(item["comment"], textChars);
      item["display_reason"] = display(item["reason"], displayChars);
      item["display_comment"] = display(item["comment"], displayChars);
      return item;
    });
    const out: FeedbackEvent = {
      ok: true,
      window_days: days,
      count: events.length,
      positions: new Set(events.map((e) => e["legacy_id"]).filter(Boolean)).size,
      with_text: events.filter((e) => eventText(e, "both").trim()).length,
      by_action: inActionOrder(byAction),
      items,
    };
    if (note) out["note"] = note;
    return out;
  };

  const themes = (args: Extract<Args, { command: "themes" }>, legacyIds: string[] | null) => {
    const days = args.days ?? DEFAULT_WINDOW_DAYS;
    const field = args.field ?? "both";
    const fetched = fetchEvents(days, legacyIds);
    const excluded = new Set((args.exclude_legacy_id ?? []).map(String));
    const events = excluded.size > 0 ? fetched.events.filter((e) => !excluded.has(String(e["legacy_id"]))) : fetched.events;
    const out: FeedbackEvent = { ok: true, window_days: days, field };
    // An attestation for callers that must show the current position's own feedback did not score itself.
    if (excluded.size > 0) out["excluded_legacy_ids"] = [...excluded].sort(pyCompare);
    Object.assign(out, aggregateThemes(events, field, args.min_positions ?? 3, args.include_cleared ?? false, args.top ?? null, display));
    if (fetched.note) out["note"] = fetched.note;
    return out;
  };

  return {
    spec: {
      name: FEEDBACK_QUERY_TOOL,
      description:
        "The user's feedback on positions (replaces `python3 …/feedback_query.py`), as JSON. " +
        "check: one position (legacy_id). recent: every event in a window. themes: the reasons the user wrote, grouped " +
        "(days, min_positions, top, field, include_cleared, exclude_legacy_id). A `note` of no-signal:* means no data, " +
        "not no feedback. Never quote reason/comment to the user; use the display_* fields, labels and examples.",
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
              ? recent(a.days ?? DEFAULT_WINDOW_DAYS, a.limit ?? DEFAULT_EVENT_LIMIT, a.text_chars ?? DEFAULT_TEXT_CHARS, ids)
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

function eventFields(event: FeedbackEvent, field: string): string[] {
  const out: string[] = [];
  if ((field === "reason" || field === "both") && event["reason"]) out.push(String(event["reason"]));
  if ((field === "comment" || field === "both") && event["comment"]) out.push(String(event["comment"]));
  return out;
}

function eventText(event: FeedbackEvent, field: string): string {
  return eventFields(event, field).join(" — ");
}

/** Free text → normalised words: accents off, lowercase, ASCII words of three letters or more, no service words. */
function words(text: string): string[] {
  const flat = text.normalize("NFKD").replace(/\p{Mn}/gu, "").toLowerCase();
  return flat.split(/[^0-9a-z]+/).filter((w) => w.length >= MIN_TOKEN_LEN && !STOPWORDS.has(w));
}

const key = (word: string) => word.slice(0, PREFIX_LEN);

/** [key, label]: the words that may stand alone, then every adjacent pair. */
function candidateThemes(ws: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const w of ws) if (!WEAK_ALONE.has(w)) out.push([key(w), w]);
  for (let i = 0; i + 1 < ws.length; i++) out.push([`${key(ws[i]!)} ${key(ws[i + 1]!)}`, `${ws[i]} ${ws[i + 1]}`]);
  return out;
}

interface Theme {
  key: string;
  positions: Set<string>;
  events: number;
  displayLabels: Map<string, number>;
  actions: Map<string, number>;
  examples: string[];
}

function aggregateThemes(
  events: FeedbackEvent[],
  field: string,
  minPositions: number,
  includeCleared: boolean,
  top: number | null,
  display: (value: unknown) => string | null,
): FeedbackEvent {
  const desc = sortedDesc(events);
  const latest = new Map<string, unknown>();
  for (const e of desc) {
    const lid = e["legacy_id"] as string | undefined;
    if (lid && !latest.has(lid)) latest.set(lid, e["action"]);
  }
  const cleared = new Set([...latest].filter(([, action]) => action === "clear").map(([lid]) => lid));

  // An event with no legacy_id cannot count towards distinct positions.
  const considered = desc.filter((e) => e["legacy_id"] && (includeCleared || !cleared.has(e["legacy_id"] as string)));
  const texted = considered.filter((e) => eventText(e, field).trim());
  const positionsWithText = new Set(texted.map((e) => e["legacy_id"] as string).filter(Boolean));

  const themes = new Map<string, Theme>();
  for (const e of texted) {
    const lid = e["legacy_id"] as string;
    const text = eventText(e, field);
    const candidates: Array<[string, string]> = [];
    const safeLabels = new Map<string, string>();
    for (const chunk of eventFields(e, field)) {
      candidates.push(...candidateThemes(words(chunk)));
      for (const [safeKey, safeLabel] of candidateThemes(words(display(chunk) ?? ""))) safeLabels.set(safeKey, safeLabel);
    }
    const seenHere = new Set<string>();
    for (const [k] of candidates) {
      let th = themes.get(k);
      if (!th) {
        th = { key: k, positions: new Set(), events: 0, displayLabels: new Map(), actions: new Map(), examples: [] };
        themes.set(k, th);
      }
      // The key comes from the raw text; the label may be shown only if the same
      // candidate survives the sanitiser, so no path or token comes back.
      const safe = safeLabels.get(k);
      if (safe) th.displayLabels.set(safe, (th.displayLabels.get(safe) ?? 0) + 1);
      if (seenHere.has(k)) continue; // the same word twice in one text counts once
      seenHere.add(k);
      th.positions.add(lid);
      th.events += 1;
      const action = e["action"];
      if (action) th.actions.set(String(action), (th.actions.get(String(action)) ?? 0) + 1);
      const snippet = pyTruncate(text.trim(), EXAMPLE_MAX_CHARS) as string;
      if (snippet && !th.examples.includes(snippet) && th.examples.length < MAX_EXAMPLES) th.examples.push(snippet);
    }
  }

  const kept = new Map([...themes].filter(([, th]) => th.positions.size >= minPositions));
  // A pair covering nearly all of a word's positions says the same thing better: the word goes.
  const absorbed = new Set<string>();
  for (const [k, th] of kept) {
    if (!k.includes(" ")) continue;
    for (const part of k.split(" ")) {
      const uni = kept.get(part);
      if (!uni || uni.positions.size === 0) continue;
      const overlap = [...th.positions].filter((p) => uni.positions.has(p)).length / uni.positions.size;
      if (overlap >= BIGRAM_ABSORB_RATIO) absorbed.add(part);
    }
  }

  const denom = positionsWithText.size || 1;
  let rows = [...kept]
    .filter(([k]) => !absorbed.has(k))
    .map(([k, th]) => ({
      key: k,
      label: mostCommon(th.displayLabels) ?? "[redacted]",
      positions: th.positions.size,
      events: th.events,
      share: new PyFloat(pyRound3(th.positions.size / denom)),
      actions: Object.fromEntries([...th.actions].sort(([a], [b]) => pyCompare(a, b))),
      legacy_ids: [...th.positions].filter(Boolean).sort(pyCompare).slice(0, MAX_THEME_IDS),
      examples: th.examples.map((ex) => display(ex)),
    }));
  rows.sort((a, b) => b.positions - a.positions || b.events - a.events || pyCompare(a.key, b.key));
  if (top) rows = rows.slice(0, top);

  const byAction = countBy(considered.map((e) => e["action"]).filter(Boolean) as string[]);
  return {
    events_total: considered.length,
    events_with_text: texted.length,
    positions_with_text: positionsWithText.size,
    positions_cleared: cleared.size,
    by_action: inActionOrder(byAction),
    min_positions: minPositions,
    themes: rows,
  };
}

/** `Counter.most_common(1)`: the highest count, the first seen on a tie. */
function mostCommon(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
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
