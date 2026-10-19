/**
 * Stand-in for `next/headers` in the desktop. The web's server pages
 * (positions, position) run here as they are, and read two cookies: the
 * visible columns and the salary currency, both written by client components
 * with document.cookie. So cookies() reads document.cookie; there is no
 * request, so headers() is empty.
 *
 * One cookie is always answered by the app: NEXT_LOCALE. The web's position
 * page takes its language from that cookie alone and falls back to Italian,
 * but the desktop speaks the system language until the person picks one
 * (lib/app-locale.ts) and writes no cookie: the Dettaglio came out in Italian
 * under an English app. So it says the app's language, whether the cookie is
 * missing or holds something that is not a language the app has.
 */
import { appLocale } from "../lib/app-locale";

type Cookie = { name: string; value: string };

const LOCALE_COOKIE = "NEXT_LOCALE";

function readCookies(): Cookie[] {
  if (typeof document === "undefined" || !document.cookie) return [];
  return document.cookie.split(";").flatMap((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return [];
    const name = part.slice(0, eq).trim();
    if (!name) return [];
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // Left as written: Next hands a malformed value back as it is too.
    }
    return [{ name, value }];
  });
}

export async function cookies() {
  const all = readCookies();
  return {
    // NEXT_LOCALE is always the app's language: appLocale() already takes the
    // cookie when it is a language the app has, and discards it when it is not.
    get: (name: string): Cookie | undefined =>
      name === LOCALE_COOKIE ? { name, value: appLocale() } : all.find((c) => c.name === name),
    getAll: (): Cookie[] => all,
    has: (name: string): boolean => all.some((c) => c.name === name),
  };
}

export async function headers(): Promise<Headers> {
  return new Headers();
}
