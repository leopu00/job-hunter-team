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
 *  3. L'intestazione `Accept-Language` del browser: chi arriva per la prima
 *     volta (nessun cookie) e non ha il file (sito cloud) NON è un utente
 *     italiano per default. La prima lingua che gestiamo, in ordine di
 *     preferenza; se il browser ne dichiara solo di non gestite, "en".
 *  4. "it" solo quando NESSUNA fonte dice qualcosa (nessuna intestazione:
 *     crawler, test, chiamate interne).
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
import { headers } from "next/headers";
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

/**
 * La lingua che dice un'intestazione `Accept-Language` ("en-US,en;q=0.9,it;q=0.8"):
 * la prima gestita per ordine di `q` (a pari `q`, per ordine di apparizione).
 * `null` se l'intestazione manca o è vuota; "en" se dichiara solo lingue che non
 * gestiamo (un browser giapponese non deve vedere l'italiano).
 */
export function localeFromAcceptLanguage(
  header: string | null | undefined,
): ServerLocale | null {
  if (!header || !header.trim()) return null;
  const entries = header
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return {
        lang: tag.trim().toLowerCase().split("-")[0],
        weight: Number.isFinite(weight) ? weight : 0,
        order,
      };
    })
    .filter((e) => e.lang && e.lang !== "*" && e.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  if (entries.length === 0) return null;
  for (const e of entries) {
    if ((VALID_LOCALES as string[]).includes(e.lang)) return e.lang as ServerLocale;
  }
  return "en";
}

export async function getServerLocale(): Promise<ServerLocale> {
  const fromCookie = await readLocaleCookie();
  if (fromCookie) return fromCookie;
  const fromFile = readLocalePrefsFile();
  if (fromFile) return fromFile;
  let fromBrowser: ServerLocale | null = null;
  try {
    fromBrowser = localeFromAcceptLanguage((await headers()).get("accept-language"));
  } catch {
    /* fuori da una request (test, build): nessuna intestazione da leggere */
  }
  return fromBrowser ?? DEFAULT_SERVER_LOCALE;
}
