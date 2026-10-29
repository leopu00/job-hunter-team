import type { Locale } from "@/i18n/config";
import type { DashboardStats } from "../../../web/lib/types";
import { AWAY_GREETING_TEXT } from "./away-greeting.i18n";
import { pluralText } from "./plural";

/**
 * «While you were away»: what the team did between the last time the app was open and this one.
 *
 * It is a comparison of two readings of the numbers the dashboard already reads (`DashboardStats`, from the cloud
 * or from the team's own database), never a new query: the reading as it is now, and the one saved the last time
 * the app was seen. A reading is a difference of totals, not a list of events, and the greeting says so by being
 * short and by counting only what went up.
 */

/** Away for less than this is not away: closing the app and opening it again a quarter of an hour later. */
export const AWAY_MINUTES = 30;
/** How often the open app saves a reading, so that a crash or a closed window leaves a recent one. */
export const HEARTBEAT_MS = 5 * 60_000;

export interface AwayCounts {
  /** Every position of the team. */
  total: number;
  /** The ones that have a score or are past it. */
  evaluated: number;
  /** The ones with a CV written (ready, applied, answered). */
  documents: number;
}

export interface AwaySnapshot {
  /** When the app was last seen, in ms. */
  at: number;
  counts: AwayCounts;
}

export interface Away {
  positions: number;
  evaluated: number;
  documents: number;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The three numbers of the greeting, from the dashboard's statistics. */
export function awayCounts(stats: DashboardStats): AwayCounts {
  const past = count(stats.ready) + count(stats.applied) + count(stats.response);
  return {
    total: count(stats.total),
    evaluated: count(stats.scored) + count(stats.writing) + count(stats.review) + past,
    documents: past,
  };
}

/**
 * What to say now, or nothing: no earlier reading (the first time), not away long enough, a reading from the
 * future (the clock moved), or nothing that went up. A team that reads as empty after a reading with positions is
 * a read that did not work, not a team that lost everything: nothing is said.
 */
export function awaySince(previous: AwaySnapshot | null, counts: AwayCounts, now: number): Away | null {
  if (!previous || previous.at > now || now - previous.at < AWAY_MINUTES * 60_000) return null;
  if (counts.total === 0 && previous.counts.total > 0) return null;
  const away = {
    positions: Math.max(0, counts.total - previous.counts.total),
    evaluated: Math.max(0, counts.evaluated - previous.counts.evaluated),
    documents: Math.max(0, counts.documents - previous.counts.documents),
  };
  return away.positions > 0 || away.evaluated > 0 || away.documents > 0 ? away : null;
}

/** Whether a reading should replace the saved one: not an empty team where there was a full one (a failed read). */
export function worthSaving(previous: AwaySnapshot | null, counts: AwayCounts): boolean {
  return !(counts.total === 0 && previous !== null && previous.counts.total > 0);
}

const PREFIX = "jht-away:";

function isCounts(value: unknown): value is AwayCounts {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return ["total", "evaluated", "documents"].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]) && (record[key] as number) >= 0);
}

export function loadSnapshot(key: string): AwaySnapshot | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFIX + key) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return null;
    const { at, counts } = parsed as { at?: unknown; counts?: unknown };
    return typeof at === "number" && Number.isFinite(at) && isCounts(counts) ? { at, counts } : null;
  } catch {
    return null;
  }
}

export function saveSnapshot(key: string, snapshot: AwaySnapshot): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(snapshot));
  } catch {
    /* no storage: the greeting does not come, and nothing else is lost */
  }
}

const TAGS: Record<Locale, string> = { it: "it-IT", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES", pt: "pt-PT", hu: "hu-HU" };

/** «Mentre eri via: 5 posizioni nuove, 3 valutate e 1 CV o lettera pronto.» Only what went up. */
export function awaySentence(locale: Locale, away: Away): string {
  const text = AWAY_GREETING_TEXT[locale];
  const parts = [
    away.positions > 0 ? pluralText(locale, away.positions, text.positions) : null,
    away.evaluated > 0 ? pluralText(locale, away.evaluated, text.evaluated) : null,
    away.documents > 0 ? pluralText(locale, away.documents, text.documents) : null,
  ].filter((part): part is string => part !== null);
  let list: string;
  try {
    list = new Intl.ListFormat(TAGS[locale], { style: "long", type: "conjunction" }).format(parts);
  } catch {
    list = parts.join(", ");
  }
  return `${text.intro} ${list}.`;
}
