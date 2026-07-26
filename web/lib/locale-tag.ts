/**
 * Tag BCP-47 per lingua, quelli che vogliono `Intl.DateTimeFormat` e i
 * vari `toLocaleString`/`toLocaleDateString`.
 *
 * Questa tabella era ricopiata in DICIOTTO file — pagine team,
 * case-studies, secrets, backup, cron, channels, positions — a volte
 * sotto un altro nome (`RUN_LOCALE_TAG` in lib/case-studies.ts). E le
 * copie avevano già smesso di coincidere: `team/critico/page.tsx`
 * mappava `en` su `en-GB` mentre tutte le altre su `en-US`, quindi con
 * l'interfaccia in inglese quella sola pagina scriveva le date in
 * formato giorno/mese e il resto dell'app mese/giorno. Qui la tabella
 * è una, nella variante di maggioranza (`en-US`).
 */
import type { Locale } from "@/i18n/config";

export const LOCALE_TAG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};

/**
 * Tag della locale indicata, inglese per qualunque valore fuori elenco.
 * Da preferire all'accesso diretto alla mappa: molti chiamanti hanno in
 * mano una `string` che arriva da un cookie o da un default di funzione,
 * non una `Locale` già validata.
 */
export function intlTag(locale: string): string {
  return LOCALE_TAG[locale as Locale] ?? LOCALE_TAG.en;
}
