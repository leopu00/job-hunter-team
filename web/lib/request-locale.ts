import { cookies } from "next/headers";
import { locales, defaultLocale, type Locale } from "@/i18n/config";

/**
 * Locale corrente lato server, letta dal cookie `NEXT_LOCALE` della request.
 *
 * Da usare nelle pagine/route component PUBBLICHE (landing, /docs, /case-studies)
 * servite sul web: lì `getServerLocale()` (che legge ~/.jht/i18n-prefs.json) non
 * è disponibile e ricadrebbe sempre sul default. Il cookie è la stessa fonte
 * usata da DashboardI18n e dal LanguageSwitcher.
 *
 * Per le pagine dell'area protetta (desktop, dove il file ~/.jht esiste)
 * continua a usare `getServerLocale()`.
 */
export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("NEXT_LOCALE")?.value;
  return raw && (locales as string[]).includes(raw)
    ? (raw as Locale)
    : defaultLocale;
}
