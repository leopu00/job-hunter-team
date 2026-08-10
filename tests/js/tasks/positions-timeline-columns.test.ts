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
 * O-34 — «CV scritto il» e «Trovata» in lista.
 *
 * Nessun dato nuovo: `applications.written_at` e `positions.found_at`
 * esistono e il dettaglio li mostra già. Quello che si rompe qui è la
 * colonna registrata A METÀ, e ogni pezzo è invisibile agli altri: la chiave
 * senza larghezza rompe il colgroup, la label mancante in una delle sette
 * lingue esce vuota, il campo popolato solo nel ramo locale lascia la colonna
 * vuota PROPRIO sul sito (è come O-31 è stata consegnata a metà).
 *
 * E soprattutto l'ORDINAMENTO: la domanda che queste due colonne devono
 * rispondere è «da quanto è ferma?», e senza sort si legge solo scorrendo
 * venti righe a mente — cioè non si legge.
 */
const ROOT = resolve(__dirname, "../../..");
const PAGE = readFileSync(
  resolve(ROOT, "web/app/(protected)/positions/page.tsx"),
  "utf-8",
);
const CLOUD = readFileSync(resolve(ROOT, "web/lib/queries.ts"), "utf-8");
const LOCAL = readFileSync(resolve(ROOT, "web/lib/local-queries.ts"), "utf-8");
const LOCALES = ["it", "en", "hu", "es", "de", "fr", "pt"] as const;

// L'oggetto dell'header di una colonna, per leggerne le opzioni (sortable).
function headerEntry(col: string): string {
  const m = PAGE.match(new RegExp(`\\{\\s*col: "${col}",[^}]*\\}`));
  return m?.[0] ?? "";
}

describe.each([
  { col: "written_at", label: "col_written_at" },
  { col: "found_at", label: "col_found_at" },
])("colonna '$col' in lista", ({ col, label }) => {
  it("è registrata fra le colonne della tabella", () => {
    expect(POSITIONS_COLUMNS).toContain(col);
  });

  it("ha una larghezza minima, come ogni altra colonna", () => {
    expect(
      POSITIONS_COL_MIN_WIDTH[col as keyof typeof POSITIONS_COL_MIN_WIDTH],
    ).toBeGreaterThan(0);
  });

  it("ha la label in tutte e sette le lingue", () => {
    for (const loc of LOCALES) {
      const text = (T[label as keyof typeof T] as Record<string, string>)[loc];
      expect(text, `manca la label ${loc}`).toBeTruthy();
    }
  });

  it("si può accendere dal picker e sopravvive al cookie", () => {
    expect(PAGE).toContain(`key: "${col}"`);
    expect(parseColumnsCookie(`title,${col}`).has(col as never)).toBe(true);
  });

  it("ha un header e una cella, non solo una chiave", () => {
    expect(headerEntry(col)).not.toBe("");
    expect(PAGE).toContain(`show("${col}")`);
  });

  it("si può ORDINARE cliccando l'intestazione", () => {
    // Il punto del ticket: filtrando "In revisione"/"Pronte da inviare" la
    // domanda è da quanto una cosa è ferma. Senza sort la colonna mostra il
    // dato e lascia il conto all'utente.
    expect(headerEntry(col)).toContain("sortable: true");
    const sortable = PAGE.slice(
      PAGE.indexOf("const SORTABLE_COLUMNS"),
      PAGE.indexOf("// Verdetto critico → colore badge"),
    );
    expect(sortable).toContain(`"${col}"`);
  });

  it("è ordinabile in ENTRAMBI i rami, non solo in locale", () => {
    // Il ramo cloud ordina in memoria su POSITION_SORT_KEYS; una chiave che
    // non è in quella lista viene ignorata in silenzio e la tabella resta
    // nell'ordine di prima — un click che non fa niente.
    const sortKeys = CLOUD.slice(
      CLOUD.indexOf("const POSITION_SORT_KEYS"),
      CLOUD.indexOf("] as const;", CLOUD.indexOf("const POSITION_SORT_KEYS")),
    );
    expect(sortKeys).toContain(`"${col}"`);
    expect(LOCAL).toContain(`case "${col}"`);
  });

  it("mostra data E ora, non solo l'ora di oggi", () => {
    // `formatFoundAt` per la giornata corrente stampa solo l'orario: in una
    // colonna che serve a misurare un'attesa, un "13:13" nudo non dice di
    // quale giorno. `formatStamp` porta sempre giorno+mese+ora.
    const cell = PAGE.slice(PAGE.indexOf(`show("${col}") && (`));
    expect(cell.slice(0, 400)).toContain(`formatStamp(p.${col}, locale)`);
  });
});

describe("il dato arriva da entrambe le sorgenti", () => {
  it("written_at è popolato sia sul cloud sia in locale", () => {
    // Cloud: `...p` porta l'array `applications`, non i suoi campi — senza
    // la riga esplicita la colonna resta vuota proprio sul sito.
    expect(CLOUD).toContain("written_at: app?.written_at");
    // Locale: `mapPosition` mappa solo la tabella positions.
    expect(LOCAL).toContain("written_at: r.written_at");
  });

  it("found_at è nella select cloud e nel mapping locale", () => {
    const select = CLOUD.slice(
      CLOUD.indexOf("export async function getPositions("),
      CLOUD.indexOf("// ── Single position with all details"),
    );
    expect(select).toContain("found_at");
    expect(LOCAL).toContain('found_at: r.found_at ?? ""');
  });

  it("written_at è nel tipo che la tabella riceve", () => {
    const types = readFileSync(resolve(ROOT, "web/lib/types.ts"), "utf-8");
    const iface = types.slice(
      types.indexOf("export interface PositionWithScore"),
      types.indexOf("// Coda notifiche agente -> utente"),
    );
    expect(iface).toContain("written_at?: string | null;");
  });
});
