/**
 * #184 — la riga e la sua intestazione devono descrivere le STESSE colonne,
 * nello stesso ordine.
 *
 * L'operatore ha segnalato la tabella /positions «disallineata»: il valore di
 * una colonna sotto l'intestazione di un'altra. In una sola `<table>` con
 * `table-fixed` questo puo' succedere per UN motivo solo — che la riga di
 * intestazione e la riga di dati non contengano lo stesso numero di celle, o
 * non nello stesso ordine. Le colonne, li' dentro, sono posizioni: la n-esima
 * cella sta sotto la n-esima intestazione, qualunque cosa dica il CSS.
 *
 * E il rischio e' concreto perche' le colonne sono descritte in TRE posti che
 * nessuno confrontava:
 *   1. `POSITIONS_COLUMNS` — l'ordine canonico;
 *   2. il `<colgroup>`, costruito filtrando l'ordine canonico;
 *   3. l'intestazione, un array scritto a mano dentro `page.tsx`;
 *   4. le celle, diciassette blocchi `{show("…") && <td>}` scritti a mano
 *      trecento righe piu' sotto.
 * Aggiungere una colonna vuol dire toccarne quattro. Dimenticarne uno non
 * rompe la compilazione, non rompe i tipi, e sposta tutto cio' che segue.
 *
 * ⚠️ Questo test NON chiude #184: sull'albero di oggi le quattro liste
 * combaciano, quindi la tabella non puo' disallinearsi per questa via e il
 * difetto segnalato ha un'altra causa (vedi la riga di backlog). Quello che
 * chiude e' la CLASSE — e con essa una delle tre ipotesi del ticket, che da
 * oggi e' esclusa da un test invece che da una lettura.
 *
 * `title` e' l'unica cella senza guardia, ed e' voluto: e' il link alla
 * posizione e `parseColumnsCookie` la reinserisce sempre. Il test lo pretende
 * da entrambi i lati — se un giorno il cookie smettesse di garantirlo, la
 * cella senza guardia diventerebbe proprio lo slittamento che qui si teme.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  POSITIONS_COLUMNS,
  parseColumnsCookie,
} from "../../../web/app/(protected)/positions/columns";

const ROOT = resolve(__dirname, "../../..");
const PAGE = readFileSync(
  join(ROOT, "web/app/(protected)/positions/page.tsx"),
  "utf-8",
);

/** L'array di intestazioni: i `col:` fino al filtro che le rende `<th>`. */
const HEADER_FILTER = ".filter(({ col }) => show(col as PositionsColumnKey))";
function headerOrder(): string[] {
  const cut = PAGE.indexOf(HEADER_FILTER);
  expect(cut, "il filtro delle intestazioni non c'e' piu'").toBeGreaterThan(0);
  return [...PAGE.slice(0, cut).matchAll(/col:\s*"(\w+)"/g)].map((m) => m[1]);
}

/** Le celle: le guardie `show("…")` dentro il corpo della tabella. */
function cellOrder(): string[] {
  const body = PAGE.slice(PAGE.indexOf("<tbody>"));
  return [...body.matchAll(/\{show\("(\w+)"\)/g)].map((m) => m[1]);
}

const CANON = [...POSITIONS_COLUMNS];
// La sola colonna che si disegna senza chiedere il permesso, e il perche'
// sta nel commento in testa: e' il link, e il cookie la garantisce.
const ALWAYS_ON = "title";

describe("#184 — intestazioni, celle e colgroup descrivono le stesse colonne", () => {
  it("le liste sono state lette davvero", () => {
    // Liste vuote renderebbero verde qualunque cosa.
    expect(CANON.length).toBeGreaterThanOrEqual(17);
    expect(headerOrder().length).toBe(CANON.length);
    expect(cellOrder().length).toBeGreaterThan(10);
  });

  it("l'intestazione segue l'ordine canonico, colonna per colonna", () => {
    expect(headerOrder()).toEqual(CANON);
  });

  it("le celle seguono lo stesso ordine, senza saltarne e senza inventarne", () => {
    expect(cellOrder()).toEqual(CANON.filter((c) => c !== ALWAYS_ON));
  });

  it("il colgroup nasce dall'ordine canonico e non da una quarta lista", () => {
    // `table-fixed`: e' il colgroup a dare la larghezza alla n-esima colonna.
    // Se nascesse da un ordine suo, ogni colonna prenderebbe la larghezza di
    // un'altra — il sintomo si legge come un disallineamento anche quando il
    // numero di celle e' giusto.
    expect(PAGE).toContain(
      "const orderedCols = POSITIONS_COLUMNS.filter((c) => show(c));",
    );
    expect(PAGE).toContain("{orderedCols.map((c) => (");
  });

  it(`la cella \`${ALWAYS_ON}\` puo' non avere guardia solo perche' il cookie la garantisce`, () => {
    // Le due meta' di un invariante che vive in due file: se una cade, la
    // riga perde una cella e tutto cio' che segue slitta di una colonna.
    expect(cellOrder()).not.toContain(ALWAYS_ON);
    for (const cookie of [
      "",
      "id",
      "id,score",
      "roba,inventata",
      "status,critic",
    ]) {
      expect(
        [...parseColumnsCookie(cookie || undefined)],
        `cookie «${cookie}» non garantisce ${ALWAYS_ON}`,
      ).toContain(ALWAYS_ON);
    }
  });

  it("ogni colonna canonica ha una cella, e ogni cella una colonna canonica", () => {
    const cells = new Set([...cellOrder(), ALWAYS_ON]);
    const mancanti = CANON.filter((c) => !cells.has(c));
    const orfane = [...cells].filter((c) => !CANON.includes(c as never));
    expect(
      { mancanti, orfane },
      "una colonna dichiarata e mai disegnata (o viceversa) sposta di uno " +
        "tutto cio' che le sta dopo: e' la forma esatta di #184",
    ).toEqual({ mancanti: [], orfane: [] });
  });
});
