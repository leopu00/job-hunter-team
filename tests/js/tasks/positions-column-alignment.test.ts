import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  POSITIONS_COLUMNS,
  POSITIONS_COL_ALIGN,
  columnAlignClass,
  columnFlexAlignClass,
  type PositionsColumnKey,
} from "../../../web/app/(protected)/positions/columns";

/**
 * O-40 — l'intestazione di una colonna deve stare sopra il suo dato.
 *
 * Il difetto non era un errore di calcolo: era che l'allineamento viveva in
 * DUE posti. L'header lo prendeva da un flag `center: true` nell'array delle
 * intestazioni, la cella da una classe Tailwind scritta a mano trecento righe
 * più sotto. Le due liste si sono separate — "LORDO/MESE" intestazione a
 * sinistra sopra importi allineati a destra (34px di scarto, misurati nel
 * browser, e crescono con la larghezza della colonna); "SCORE" etichetta
 * centrata sulla colonna mentre il numero restava 28px più a sinistra, perché
 * a essere centrato era il gruppo numero+barra e non il numero.
 *
 * Questo test non guarda uno screenshot: verifica che header e celle leggano
 * la STESSA mappa, così le due non possono più scollarsi. Lo scarto a schermo
 * è stato misurato a parte con Playwright (0px su tutte e 17 le colonne, a
 * 1440 e 2600 px, in tutte e sette le lingue).
 */
const ROOT = resolve(__dirname, "../../..");
const PAGE = readFileSync(
  resolve(ROOT, "web/app/(protected)/positions/page.tsx"),
  "utf-8",
);

describe("allineamento colonne /positions", () => {
  it("ogni colonna ha un allineamento dichiarato", () => {
    for (const col of POSITIONS_COLUMNS) {
      expect(
        POSITIONS_COL_ALIGN[col as PositionsColumnKey],
        `manca l'allineamento di ${col}`,
      ).toMatch(/^(left|center|right)$/);
    }
  });

  it("la classe della cella e quella dell'intestazione vengono dalla stessa voce", () => {
    const EXPECTED = {
      left: ["text-left", "justify-start"],
      center: ["text-center", "justify-center"],
      right: ["text-right", "justify-end"],
    } as const;
    for (const col of POSITIONS_COLUMNS) {
      const key = col as PositionsColumnKey;
      const [text, flex] = EXPECTED[POSITIONS_COL_ALIGN[key]];
      expect(columnAlignClass(key)).toBe(text);
      expect(columnFlexAlignClass(key)).toBe(flex);
    }
  });

  it("gli importi mensili si leggono a destra, etichetta compresa", () => {
    // Le celle sono numeri incolonnati a destra: se l'intestazione resta a
    // sinistra, lo scarto è tutta la larghezza della colonna meno l'etichetta.
    expect(POSITIONS_COL_ALIGN.monthly).toBe("right");
  });

  it("lo score è ancorato a sinistra: l'etichetta sta sopra il numero", () => {
    // La cella è numero + barra. Centrare la cella centra il GRUPPO e porta il
    // numero fuori dall'etichetta; a sinistra il numero le sta sotto a
    // qualunque larghezza, e la barra lo segue.
    expect(POSITIONS_COL_ALIGN.score).toBe("left");
  });

  it("page.tsx chiede l'allineamento alla mappa per ogni colonna", () => {
    // L'intestazione lo fa una volta sola, nel map delle <th>.
    expect(PAGE).toContain("columnAlignClass(col as PositionsColumnKey)");
    // Ogni cella lo fa per la propria colonna: se ne salta una, quella colonna
    // torna a decidere da sé e il difetto rientra da lì.
    for (const col of POSITIONS_COLUMNS) {
      expect(PAGE, `la cella di ${col} non usa la mappa`).toContain(
        `columnAlignClass("${col}")`,
      );
    }
    expect(PAGE).toContain('columnFlexAlignClass("score")');
  });

  it("nessuna cella della tabella si allinea per conto suo", () => {
    // Le celle della tabella sono `px-4 py-3`. Una classe di allineamento
    // scritta a mano lì dentro è esattamente il modo in cui le due liste si
    // erano separate. (Lo stato vuoto è `px-4 py-12`: non è una colonna.)
    const hardcoded = PAGE.match(
      /className="px-4 py-3[^"]*\b(?:text-(?:left|center|right)|justify-(?:start|center|end))\b[^"]*"/g,
    );
    expect(hardcoded ?? []).toEqual([]);
    // E il vecchio flag non deve tornare a vivere accanto alle etichette.
    expect(PAGE).not.toMatch(/center:\s*true/);
  });
});
