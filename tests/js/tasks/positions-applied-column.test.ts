import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  POSITIONS_COLUMNS,
  POSITIONS_COL_MIN_WIDTH,
  parseColumnsCookie,
} from "../../../web/app/(protected)/positions/columns";
import { T } from "../../../web/app/(protected)/positions/page.i18n";

/**
 * O-25 — «vedere DOVUNQUE se la candidatura è partita, e l'ORARIO ESATTO».
 *
 * Lo stato 'applied' diceva già SE; mancava QUANDO, che è la metà chiesta in
 * maiuscolo. Il difetto da prevenire qui non è il dato — quello c'era — ma la
 * colonna registrata A METÀ: una chiave nell'array senza larghezza, senza
 * label in una delle sette lingue, o assente dal picker, produce una colonna
 * che esiste per il server e non si riesce ad accendere, oppure che si accende
 * e rompe il layout. Ognuno di questi pezzi è invisibile agli altri.
 */
const ROOT = resolve(__dirname, "../../..");
const PAGE = readFileSync(
  resolve(ROOT, "web/app/(protected)/positions/page.tsx"),
  "utf-8",
);
const EVENT_STAMP = readFileSync(
  resolve(ROOT, "web/lib/position-event-stamp.ts"),
  "utf-8",
);
const LOCALES = ["it", "en", "hu", "es", "de", "fr", "pt"] as const;

describe("colonna 'candidatura inviata' in lista", () => {
  it("è registrata fra le colonne della tabella", () => {
    expect(POSITIONS_COLUMNS).toContain("applied_at");
  });

  it("ha una larghezza minima, come ogni altra colonna", () => {
    // Senza, il colgroup calcola una proporzione su undefined e la tabella
    // perde la sua geometria.
    expect(POSITIONS_COL_MIN_WIDTH.applied_at).toBeGreaterThan(0);
  });

  it("ha la label in tutte e sette le lingue", () => {
    for (const loc of LOCALES) {
      const label = (T.col_applied_at as Record<string, string>)[loc];
      expect(label, `manca la label ${loc}`).toBeTruthy();
    }
  });

  it("si può accendere dal picker e sopravvive al cookie", () => {
    expect(PAGE).toContain('key: "applied_at"');
    const chosen = parseColumnsCookie("title,applied_at");
    expect(chosen.has("applied_at")).toBe(true);
  });

  it("ha un header e una cella, non solo una chiave", () => {
    expect(PAGE).toContain('col: "applied_at"');
    expect(PAGE).toContain('show("applied_at")');
  });

  it("mostra data E ora, anche per oggi", () => {
    // `formatFoundAt` per la giornata corrente mostra solo l'ora: scorrendo
    // cinquanta righe un "13:13" nudo si confonde con quello di ieri, ed è
    // esattamente ciò che la richiesta escludeva.
    // Il formatter canonico è condiviso anche col pannello dettaglio: qui si
    // verifica la sua semantica, non una copia privata nella pagina lista.
    expect(EVENT_STAMP).toContain("day:");
    expect(EVENT_STAMP).toContain("month:");
    expect(EVENT_STAMP).toContain("hour:");
    expect(EVENT_STAMP).toContain("minute:");
    expect(EVENT_STAMP).not.toContain("sameDay");
  });

  it("il dato arriva da entrambe le sorgenti, non solo dal cloud", () => {
    // Local-first: in locale la lista si costruisce da SQLite, e una colonna
    // popolata solo nel ramo Supabase resterebbe vuota proprio sul box.
    const local = readFileSync(resolve(ROOT, "web/lib/local-queries.ts"), "utf-8");
    const cloud = readFileSync(resolve(ROOT, "web/lib/queries.ts"), "utf-8");
    expect(local).toContain("applied_at: r.applied_at");
    expect(cloud).toContain("applied_at: app?.applied_at");
  });

  it("è ordinabile in entrambi i rami", () => {
    const cloud = readFileSync(resolve(ROOT, "web/lib/queries.ts"), "utf-8");
    const local = readFileSync(resolve(ROOT, "web/lib/local-queries.ts"), "utf-8");
    // Chiave assente da POSITION_SORT_KEYS = ordinamento ignorato in
    // silenzio sul cloud (la lista resta com'era, il click non fa niente).
    const sortKeys = cloud.slice(
      cloud.indexOf("const POSITION_SORT_KEYS"),
      cloud.indexOf("] as const;", cloud.indexOf("const POSITION_SORT_KEYS")),
    );
    expect(sortKeys).toContain('"applied_at"');
    expect(local).toContain('case "applied_at"');
  });
});

describe("la stessa informazione nel dettaglio", () => {
  it("il pulsante mostra l'ora registrata, non solo la conferma", () => {
    const src = readFileSync(
      resolve(ROOT, "web/app/(protected)/positions/[id]/FeedbackButtons.tsx"),
      "utf-8",
    );
    expect(src).toContain("initialAppliedAt");
    expect(src).toContain("formatAppliedAt");
    // L'ora viene dalla risposta di chi scrive, non dall'orologio del browser.
    expect(src).toContain("saved?.applied_at");
  });
});
