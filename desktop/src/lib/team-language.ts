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

/** The ask is for a team that speaks English and an app that does not. */
export function shouldAskTeamLanguage(team: TeamLanguage | null, app: Locale): boolean {
  return team !== null && team.locale === "en" && app !== "en";
}

/**
 * Sets the team's language. It writes only over the English every team starts with: a team that has a
 * language of its own answers `changed: false` and keeps it. A native refusal (a read-only link, a VPS not
 * yet claimed) arrives as its code, which the caller tells with the error catalog.
 */
export async function setTeamLanguage(locale: Locale): Promise<{ ok: true; language: TeamLanguage } | { ok: false; code: string }> {
  if (!isTauri()) return { ok: false, code: "desktop_only" };
  try {
    const language = teamLanguageReply(await invoke("direct_chat_team_language_set", { locale }));
    return language ? { ok: true, language } : { ok: false, code: "persist_failed" };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" ? code : "persist_failed" };
  }
}

const ASKED_PREFIX = "jht-team-language-asked:";

/** Whether this person already answered the question for this account on this computer. */
export function teamLanguageAsked(identityKey: string): boolean {
  try {
    return localStorage.getItem(ASKED_PREFIX + identityKey) === "1";
  } catch {
    return false;
  }
}

export function rememberTeamLanguageAsked(identityKey: string): void {
  try {
    localStorage.setItem(ASKED_PREFIX + identityKey, "1");
  } catch {
    /* no storage: the question may come once more */
  }
}
