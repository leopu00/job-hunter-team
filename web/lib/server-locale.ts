/**
 * Locale delle pagine dell'area protetta, risolta lato server.
 *
 * ORDINE DI PRECEDENZA: cookie `NEXT_LOCALE` → file ~/.jht/i18n-prefs.json →
 * "it". Le prime due fonti possono divergere, quindi il perché dell'ordine:
 *
 *  1. Il cookie è l'atto più recente dell'utente. `POST /api/i18n` è l'UNICO
 *     punto del repo che scrive i18n-prefs.json, e nella stessa risposta setta
 *     sempre il cookie: il file non può quindi essere più fresco del cookie.
 *     Il contrario sì — sul cloud la scrittura del file fallisce (filesystem
 *     read-only) e il cookie resta l'unica traccia della scelta.
 *  2. Il file resta il fallback persistente: sopravvive alla pulizia dei
 *     cookie e vale per qualunque browser apra il desktop su localhost. Sul
 *     desktop, dove il file esiste, comanda ancora lui ogni volta che il
 *     cookie manca.
 *  3. "it" solo quando NESSUNA delle due fonti dice qualcosa.
 *
 * È lo stesso ordine di `GET /api/i18n` e del client (`lib/use-locale`, che
 * legge il cookie): server e browser rendono così la stessa lingua.
 *
 * Il difetto che questo ordine chiude: prima si leggeva solo il file, e sul
 * sito cloud quel file non esiste. Il `catch` scattava a ogni richiesta e
 * l'area riservata tornava in italiano anche con l'interfaccia in inglese —
 * "DISTRIBUZIONE SCORE" sulla /map. L'ASSENZA DEL FILE NON È UNA PREFERENZA
 * PER L'ITALIANO: è mancanza di informazione, e va chiesta alla fonte dopo.
 *
 * Sulla cache: leggere il cookie non rende una lingua "appiccicata" a una
 * risposta condivisa. Nessuna pagina sotto app/(protected) dichiara
 * `revalidate` o `dynamic = "force-static"`, e il layout del gruppo chiama già
 * `cookies()` (per la Navbar): l'intero gruppo è già reso per-richiesta. In
 * ogni caso `cookies()` fa uscire la rotta dal prerender statico da sé.
 */
import fs from "node:fs";
import path from "node:path";
import { JHT_HOME } from "@/lib/jht-paths";
import { readLocaleCookie } from "@/lib/request-locale";

export type ServerLocale = "it" | "en" | "hu" | "es" | "de" | "fr" | "pt";

const VALID_LOCALES: ServerLocale[] = [
  "it",
  "en",
  "hu",
  "es",
  "de",
  "fr",
  "pt",
];

const DEFAULT_SERVER_LOCALE: ServerLocale = "it";

const PREFS_PATH = path.join(JHT_HOME, "i18n-prefs.json");

/**
 * Preferenza persistita dal desktop, o `null` se il file non c'è / è illeggibile
 * / contiene una lingua sconosciuta. `null` e non "it": chi chiama deve poter
 * distinguere "nessuna preferenza" da "preferenza = italiano".
 */
export function readLocalePrefsFile(): ServerLocale | null {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
    if (VALID_LOCALES.includes(raw?.locale)) return raw.locale as ServerLocale;
  } catch {
    /* file assente (è il caso normale sul cloud) o JSON rotto */
  }
  return null;
}

export async function getServerLocale(): Promise<ServerLocale> {
  const fromCookie = await readLocaleCookie();
  if (fromCookie) return fromCookie;
  return readLocalePrefsFile() ?? DEFAULT_SERVER_LOCALE;
}
