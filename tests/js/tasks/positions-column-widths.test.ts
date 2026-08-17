import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  POSITIONS_COLUMNS,
  POSITIONS_COL_LABEL_KEY,
  POSITIONS_COL_MIN_WIDTH,
  type PositionsColumnKey,
} from "../../../web/app/(protected)/positions/columns";
import {
  headerMinWidth,
  widestHeaderWidth,
} from "../../../web/app/(protected)/positions/header-width";
import { T } from "../../../web/app/(protected)/positions/page.i18n";

/**
 * O-39 — le larghezze minime delle colonne erano state scelte guardando
 * l'italiano. In sette lingue l'italiano non è quasi mai la più lunga: sei
 * colonne su diciassette uscivano troncate in tedesco o ungherese, con
 * l'ellissi sopra la freccia di ordinamento — che è anche il comando per
 * ordinare, quindi non è solo estetica.
 *
 * Questo test non guarda uno screenshot: ricalcola il minimo dal DIZIONARIO,
 * lingua per lingua. Una traduzione aggiunta o allungata domani fa fallire
 * qui, invece di arrivare tagliata in produzione in una lingua che nessuno
 * di noi legge.
 */
const ROOT = resolve(__dirname, "../../..");
const PAGE = readFileSync(
  resolve(ROOT, "web/app/(protected)/positions/page.tsx"),
  "utf-8",
);
const LOCALES = ["it", "en", "hu", "es", "de", "fr", "pt"] as const;

function labelsOf(key: string): string[] {
  const entry = T[key as keyof typeof T] as Record<string, string>;
  // L'header è reso in maiuscolo (uppercase): è quello che occupa spazio.
  return LOCALES.map((l) => entry[l].toUpperCase());
}

describe("larghezze minime vs etichette tradotte", () => {
  it.each(
    POSITIONS_COLUMNS.filter(
      (c) => POSITIONS_COL_LABEL_KEY[c as PositionsColumnKey] !== null,
    ),
  )("'%s' regge la sua traduzione più lunga", (col) => {
    const key = POSITIONS_COL_LABEL_KEY[col as PositionsColumnKey]!;
    const labels = labelsOf(key);
    const need = widestHeaderWidth(labels);
    const widest = labels.reduce((a, b) => (b.length > a.length ? b : a));
    expect(
      POSITIONS_COL_MIN_WIDTH[col as PositionsColumnKey],
      `"${widest}" chiede ${need}px`,
    ).toBeGreaterThanOrEqual(need);
  });

  it("la colonna ID non ha etichetta tradotta (è 'ID' ovunque)", () => {
    expect(POSITIONS_COL_LABEL_KEY.id).toBeNull();
    expect(POSITIONS_COL_MIN_WIDTH.id).toBeGreaterThanOrEqual(
      headerMinWidth("ID"),
    );
  });

  it("ogni etichetta esiste in tutte e sette le lingue", () => {
    // Una lingua mancante darebbe `undefined` a `toUpperCase()` e farebbe
    // esplodere il calcolo invece di misurare: meglio dirlo chiaramente.
    for (const col of POSITIONS_COLUMNS) {
      const key = POSITIONS_COL_LABEL_KEY[col as PositionsColumnKey];
      if (!key) continue;
      const entry = T[key as keyof typeof T] as Record<string, string>;
      for (const loc of LOCALES) {
        expect(entry?.[loc], `manca ${key}.${loc}`).toBeTruthy();
      }
    }
  });

  it("la mappa colonna → etichetta dice il vero su page.tsx", () => {
    // Senza questo controllo la mappa potrebbe restare indietro dopo un
    // rename, e il test sopra misurerebbe con serenità la label sbagliata.
    for (const col of POSITIONS_COLUMNS) {
      const key = POSITIONS_COL_LABEL_KEY[col as PositionsColumnKey];
      const entry = PAGE.match(
        new RegExp(`\\{\\s*col: "${col}",[^}]*\\}`),
      )?.[0];
      expect(entry, `nessun header per ${col}`).toBeTruthy();
      if (key) expect(entry).toContain(`tr("${key}")`);
      else expect(entry).toContain('label: "ID"');
    }
  });
});
