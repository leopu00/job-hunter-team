import { cookies } from "next/headers";
import { locales, defaultLocale, type Locale } from "@/i18n/config";

/**
 * Valore del cookie `NEXT_LOCALE`, oppure `null` se il cookie non c'è o
 * contiene una lingua che non gestiamo.
 *
 * Serve a chi deve distinguere «il cookie non c'è» da «il cookie dice it»:
 * l'area protetta ricade sulla preferenza persistita in ~/.jht solo nel primo
 * caso (vedi `getServerLocale`). Se restituissimo il default al posto di null,
 * quella distinzione andrebbe persa e il file non verrebbe mai consultato.
 */
export async function readLocaleCookie(): Promise<Locale | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("NEXT_LOCALE")?.value;
  return raw && (locales as string[]).includes(raw) ? (raw as Locale) : null;
}

/**
 * Locale corrente lato server, letta dal cookie `NEXT_LOCALE` della request.
 *
 * È la fonte delle pagine PUBBLICHE (landing, /docs, /case-studies), dove non
 * esiste nient'altro: nessun account, nessun file di preferenze. È anche la
 * stessa fonte che usano il client (`lib/use-locale`) e `GET /api/i18n`.
 *
 * Nell'area protetta usa `getServerLocale()`: ha lo stesso cookie come prima
 * scelta, ma in più conosce la preferenza persistita del desktop.
 */
export async function getRequestLocale(): Promise<Locale> {
  return (await readLocaleCookie()) ?? defaultLocale;
}
