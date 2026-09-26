import type { Locale } from "@/i18n/config";
import { readLocaleCookie } from "@/lib/use-locale";

/**
 * Stand-in for web/lib/server-locale.ts. The web reads the NEXT_LOCALE cookie
 * and then a preferences file on disk; the desktop reads the same cookie (and
 * the `jht-lang` fallback) through the web's own client helper.
 */
export type ServerLocale = Locale;

export async function getServerLocale(): Promise<ServerLocale> {
  return readLocaleCookie();
}
