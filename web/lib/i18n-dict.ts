/**
 * Forma e accesso ai dizionari di traduzione dell'app.
 *
 * Ogni area (una pagina, un componente) tiene il proprio dizionario in un
 * file `*.i18n.ts` accanto al codice che lo usa. Le chiavi sono LOCALI a
 * quell'area di proposito: `empty` vale "nessun backup trovato" in una
 * pagina e "nessun canale trovato" in un'altra, e un dizionario comune
 * globale le farebbe collidere in silenzio.
 *
 * Il punto di questo modulo è il tipo `LocaleDict`: `Record<Locale, string>`
 * significa che **il compilatore pretende tutte e sette le lingue**. Una
 * voce a cui manca il tedesco non compila più, invece di arrivare in
 * produzione e mostrare l'inglese a un utente tedesco — che è esattamente
 * come sono nati i buchi negli overlay della landing.
 */
import type { Locale } from "@/i18n/config";

/** Una voce tradotta. Tutte e sette le lingue, garantite dal compilatore. */
export type LocaleDict = Record<Locale, string>;

/** Un dizionario d'area: chiave locale → traduzioni. */
export type Dictionary = Record<string, LocaleDict>;

/**
 * Accessor per un dizionario, nella locale corrente.
 *
 * Risoluzione: lingua richiesta → inglese → la chiave stessa. Il terzo
 * gradino serve a non far sparire la UI se una chiave non esiste: si vede
 * il nome grezzo, che è brutto ma diagnostico (ed è ciò che lo smoke test
 * i18n cerca a schermo).
 *
 * La chiave è `string` e non `keyof D` perché alcuni chiamanti la
 * compongono a runtime (`tr(\`quality_${pref}\`)`).
 */
export function makeT(dict: Dictionary, locale: string) {
  return (key: string): string =>
    dict[key]?.[locale as Locale] ?? dict[key]?.en ?? key;
}

/**
 * Variante per i dizionari organizzati per lingua invece che per chiave
 * (`{ it: {...}, en: {...} }`), forma usata da `lib/dashboard-i18n.ts`.
 */
export function makeTByLocale<T extends Record<string, unknown>>(
  byLocale: Record<Locale, T>,
  locale: string,
): T {
  return byLocale[locale as Locale] ?? byLocale.en;
}
