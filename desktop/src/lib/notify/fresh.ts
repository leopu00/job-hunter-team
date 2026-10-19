import type { Locale } from "@/i18n/config";
import { pluralText } from "../plural";
import { NOTIFY_TEXT } from "./notify.i18n";
import type { NotifyPrefs } from "./prefs";

/** A position as the watchers read it: only what a notification may carry, and what tells it apart. */
export type FoundPosition = { id: string; title: string | null; company: string | null; foundAt: string | null };

/**
 * A position found longer ago than this before the watcher started is not new: a sync that
 * catches up, or rows that come back after a restore, never make a storm of notifications.
 */
export const BACKLOG_MS = 60 * 60 * 1000;
/** How many ids a watcher remembers, newest kept. */
export const SEEN_MAX = 2000;
/** Above this many at once, one notification says how many, without names. */
export const DETAILS_MAX = 3;
/** The longest title or company a notification shows. */
export const TEXT_MAX = 80;

/**
 * What is new for one watcher. With `silentFirst` (a list read again and again, the VPS) the first
 * read only learns what is already there and says nothing. A position already seen, without a
 * time it was found, or found before the backlog's edge is not new.
 */
export function createFreshFilter(opts: { startedAt: number; silentFirst: boolean }) {
  const seen = new Set<string>();
  let first = opts.silentFirst;
  const remember = (id: string) => {
    seen.delete(id);
    seen.add(id);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value as string);
  };
  return {
    take(rows: FoundPosition[]): FoundPosition[] {
      const fresh: FoundPosition[] = [];
      for (const row of rows) {
        if (!row.id || seen.has(row.id)) continue;
        remember(row.id);
        if (first) continue;
        const at = row.foundAt ? Date.parse(row.foundAt) : NaN;
        if (Number.isNaN(at) || at < opts.startedAt - BACKLOG_MS) continue;
        fresh.push(row);
      }
      first = false;
      return fresh;
    },
  };
}

// C0/C1 controls and the explicit bidi marks, embeddings, overrides and isolates. Not the whole
// Cf category: it also holds the zero-width non-joiner Persian needs inside a word.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g;

/** A title or a company as a notification shows it: no control or bidi character, one line, at most TEXT_MAX. */
export function cleanText(value: string | null, max = TEXT_MAX): string {
  const text = (value ?? "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export type SystemNotification = { title: string; body: string };

/**
 * The notifications for new positions. Off: none. Without details: one, "New position found" or
 * "N new positions found". With details: the title and the company of each, up to DETAILS_MAX;
 * more at once: one that says how many, never their names.
 */
export function notificationsFor(rows: FoundPosition[], prefs: NotifyPrefs, locale: Locale): SystemNotification[] {
  if (!prefs.enabled || rows.length === 0) return [];
  const t = NOTIFY_TEXT[locale];
  if (!prefs.details || rows.length > DETAILS_MAX) {
    return [{ title: t.appName, body: rows.length === 1 ? t.newOne : pluralText(locale, rows.length, t.newMany) }];
  }
  return rows.map((row) => ({ title: cleanText(row.title) || t.newOne, body: cleanText(row.company) }));
}
