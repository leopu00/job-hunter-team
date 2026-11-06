import { invoke, isTauri } from "@tauri-apps/api/core";
import { locales, type Locale } from "@/i18n/config";

/**
 * The language the team's agents speak, and the one question the app asks about it.
 *
 * The team keeps it in `i18n-prefs.json` (docs/internal/2026-08-12-language-source-contract.md); the native
 * side reads and writes that file through the chat's channel, in the local team, the existing team's pinned
 * container and the VPS the app made. Everything starts in English: the install writes `en` before the
 * person has said anything, so a team that speaks English is a team that was never asked.
 */
export interface TeamLanguage {
  /** The language the team speaks now: the file, else the environment, else `host.env`, else English. */
  locale: Locale;
  /** What the file says; null while it is missing or unreadable. */
  stored: Locale | null;
  /** After a set: false when the team already had a language of its own and nothing was written. */
  changed?: boolean;
}

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** The reply as the page may trust it: one of the seven languages in both fields, or nothing. */
export function teamLanguageReply(value: unknown): TeamLanguage | null {
  if (typeof value !== "object" || value === null) return null;
  const { locale, stored, changed } = value as Record<string, unknown>;
  if (!isLocale(locale) || !(stored === null || isLocale(stored))) return null;
  return { locale, stored, ...(typeof changed === "boolean" ? { changed } : {}) };
}

/** The team's language; null when the app is not the desktop or the team did not answer. */
export async function readTeamLanguage(): Promise<TeamLanguage | null> {
  if (!isTauri()) return null;
  try {
    return teamLanguageReply(await invoke("direct_chat_team_language"));
  } catch {
    return null;
  }
}

/** The ask is for a team that speaks another language than the app: the English it was installed with, or the one it had before the app's language changed. */
export function shouldAskTeamLanguage(team: TeamLanguage | null, app: Locale): boolean {
  return team !== null && team.locale !== app;
}

/**
 * Sets the team's language. Without `choose` (the app following the language said on its first screen) it writes
 * only over the English every team starts with: a team that has a language of its own answers `changed: false`
 * and keeps it. With `choose` it is the person's own answer and replaces the team's language; the agents take it
 * from their next message. A native refusal (a read-only link, a VPS not yet claimed) arrives as its code, which
 * the caller tells with the error catalog.
 */
export async function setTeamLanguage(
  locale: Locale,
  options?: { choose?: boolean },
): Promise<{ ok: true; language: TeamLanguage } | { ok: false; code: string }> {
  if (!isTauri()) return { ok: false, code: "desktop_only" };
  try {
    const args = options?.choose ? { locale, choose: true } : { locale };
    const language = teamLanguageReply(await invoke("direct_chat_team_language_set", args));
    return language ? { ok: true, language } : { ok: false, code: "persist_failed" };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" ? code : "persist_failed" };
  }
}

const ASKED_PREFIX = "jht-team-language-asked:";
const PUT_OFF_PREFIX = "jht-team-language-put-off:";

/**
 * Whether this person already answered the question for this account and this language of the app, on this
 * computer. A new language of the app asks once more: a team left in English while the app spoke English is not a
 * team that chose English for someone who now reads Italian. (The older «1» answered no language in particular.)
 */
export function teamLanguageAsked(identityKey: string, app: Locale): boolean {
  try {
    if (localStorage.getItem(ASKED_PREFIX + identityKey) === app) return true;
  } catch {
    /* no storage: asked as if new */
  }
  try {
    return sessionStorage.getItem(PUT_OFF_PREFIX + identityKey) === app;
  } catch {
    return false;
  }
}

export function rememberTeamLanguageAsked(identityKey: string, app: Locale): void {
  try {
    localStorage.setItem(ASKED_PREFIX + identityKey, app);
  } catch {
    /* no storage: the question may come once more */
  }
}

/** Escape: not an answer, so not remembered for good; the reloads of this run of the app do not ask again. */
export function putOffTeamLanguage(identityKey: string, app: Locale): void {
  try {
    sessionStorage.setItem(PUT_OFF_PREFIX + identityKey, app);
  } catch {
    /* no storage: the next reload asks again */
  }
}
