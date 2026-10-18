import CATALOG from "../../shared/agent-state/catalog.json";

/**
 * What an agent is doing, as shared/skills/agent_state.py tells it, and the
 * line a person reads for it: one line, icon + word + reason + when. The
 * sentences are the catalog's (shared/agent-state/catalog.json, 7 languages);
 * the reason is a code chosen by the computation, never a text the agent
 * wrote, and a code the catalog does not have is left out, not shown.
 */

export const AGENT_STATES = [
  "spento",
  "idle",
  "lavora",
  "bloccato",
  "aspetta_umano",
  "sconosciuto",
  "avviato_mai_partito",
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === "string" && (AGENT_STATES as readonly string[]).includes(value);
}

export type AgentStateTone = "green" | "neutral" | "amber" | "blue" | "red" | "grey";

type Catalog = {
  languages: string[];
  states: Record<string, { icon: string; tone: AgentStateTone; text: Record<string, string> }>;
  reasons: Record<string, { tone?: AgentStateTone; text: Record<string, string> }>;
};
const catalog = CATALOG as Catalog;

/** A reason that has a sentence in the catalog. */
export function isKnownReason(value: unknown): value is string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(catalog.reasons, value);
}

export type AgentStateInfo = {
  state: AgentState;
  reason?: string;
  /** when the state began, epoch ms */
  since?: number;
  /** when a block lifts, epoch ms */
  until?: number;
};

/**
 * The states a person is told about: the anomalous ones. A working agent is
 * shown by its work, a free one needs no line.
 */
export function isAnomalous(state: AgentState): boolean {
  return state === "bloccato" || state === "aspetta_umano" || state === "sconosciuto" || state === "avviato_mai_partito";
}

function pick(text: Record<string, string>, locale: string): string {
  return text[locale] ?? text.en ?? Object.values(text)[0] ?? "";
}

function clock(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** "12 min", "2 h": a length of time, in the person's language. */
function span(ms: number, locale: string): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const [value, unit] = minutes >= 120 ? [Math.round(minutes / 60), "hour"] : [minutes, "minute"];
  try {
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(value);
  } catch {
    return `${value} ${unit === "hour" ? "h" : "min"}`;
  }
}

function ago(ms: number, locale: string): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const [value, unit] = minutes >= 120 ? [Math.round(minutes / 60), "hour"] : [minutes, "minute"];
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "narrow" }).format(-value, unit as Intl.RelativeTimeFormatUnit);
  } catch {
    return `${value} ${unit === "hour" ? "h" : "min"}`;
  }
}

/** The reasons whose {d} is the time left (to `until`); the others count from `since`. */
const DURATION_IS_LEFT = new Set(["pausa_pacing"]);

export type AgentStateLine = {
  icon: string;
  tone: AgentStateTone;
  /** the state's word */
  word: string;
  /** the reason's sentence, filled in; null when the state has none */
  reason: string | null;
  /** how long ago it began ("5 min ago"); null when the reason already carries a time */
  when: string | null;
  /** the whole line: "⏸ bloccato · limite di 5 ore · riprova 14:05" */
  line: string;
};

export function describeAgentState(info: AgentStateInfo, locale: string, now = Date.now()): AgentStateLine {
  const entry = catalog.states[info.state];
  const word = pick(entry.text, locale);
  let tone = entry.tone;
  let reason: string | null = null;
  let timed = false;
  if (info.reason && isKnownReason(info.reason)) {
    const r = catalog.reasons[info.reason];
    if (r.tone) tone = r.tone;
    let text = pick(r.text, locale);
    timed = text.includes("{t}") && info.until != null;
    if (text.includes("{t}")) {
      // no time known: only what comes before the "· retry {t}" part
      text = info.until != null ? text.replace("{t}", clock(info.until, locale)) : text.split(" · ")[0];
    }
    if (text.includes("{d}")) {
      timed = true;
      const from = DURATION_IS_LEFT.has(info.reason) ? info.until : info.since;
      const length = from == null ? null : DURATION_IS_LEFT.has(info.reason) ? from - now : now - from;
      text = length == null ? text.split(" · ")[0].replace(/\s*\{d\}.*$/, "") : text.replace("{d}", span(length, locale));
    }
    reason = text;
  }
  // when: a state that says no time of its own says how long ago it began
  const when = !timed && info.since != null && isAnomalous(info.state) ? ago(now - info.since, locale) : null;
  const line = [`${entry.icon} ${word}`, reason, when].filter(Boolean).join(" · ");
  return { icon: entry.icon, tone, word, reason, when, line };
}
