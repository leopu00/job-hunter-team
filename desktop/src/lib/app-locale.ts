import { locales, type Locale } from "@/i18n/config";

/**
 * The language the desktop speaks. The person's own choice comes first (the
 * NEXT_LOCALE cookie the language menu writes, or the older `jht-lang`); with
 * none, the language of the system (on Windows, the display language the
 * webview reports); with a system language the app does not have, English.
 * Never a fixed Italian: an Italian Windows gets Italian, a German one
 * German, a Japanese one English.
 */
export function appLocale(): Locale {
  return explicitLocale() ?? systemLocale();
}

export function explicitLocale(): Locale | null {
  if (typeof document !== "undefined") {
    const raw = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)?.[1];
    if (isLocale(raw)) return raw;
  }
  try {
    const stored = localStorage.getItem("jht-lang");
    if (isLocale(stored)) return stored;
  } catch {
    /* no storage */
  }
  return null;
}

/** The first system language the app has, by its primary subtag ("it-IT" → it). */
export function systemLocale(languages: readonly string[] = navigatorLanguages()): Locale {
  for (const tag of languages) {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return "en";
}

function navigatorLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
