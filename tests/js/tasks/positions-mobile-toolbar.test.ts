/**
 * O-42 — a 390px la toolbar di /positions usciva dal viewport: i chip «100» e
 * «200» delle righe per pagina finivano oltre il bordo destro, irraggiungibili
 * (sotto md la tabella è una lista di card, quindi non c'era nemmeno uno
 * scroll orizzontale a cui appigliarsi).
 *
 * La causa era una riga sola non interrompibile — `h-8 flex` senza wrap — con
 * dentro filtri, ordinamento, ricerca e i quattro chip. Il rimedio è lasciarla
 * andare a capo sotto md, dove la sidebar è impilata e non c'è nessun
 * allineamento da rispettare; da md in su la riga singola e l'altezza fissa
 * restano, perché lì servono ad allineare la tabella con la prima card dei
 * filtri.
 *
 * Il test guarda le classi perché è ciò che si può leggere senza un browser;
 * la misura vera è stata fatta con Playwright — `scrollWidth == clientWidth`
 * a 360 e 390px, e nessun elemento oltre il bordo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SHELL = readFileSync(
  join(ROOT, "web/app/(protected)/positions/PositionsShell.tsx"),
  "utf-8",
);
const toolbar = SHELL.match(/className="mb-4 flex[^"]*"/)?.[0] ?? "";

describe("toolbar /positions su viewport stretti", () => {
  it("la toolbar è quella che credo di guardare", () => {
    expect(toolbar).not.toBe("");
  });

  it("va a capo sotto md", () => {
    expect(toolbar).toContain("flex-wrap");
  });

  it("resta su una riga sola da md in su", () => {
    // Senza `md:flex-nowrap` il wrap resterebbe attivo anche sul desktop:
    // basterebbe una lingua con etichette lunghe per spezzare la toolbar
    // dove oggi non si spezza.
    expect(toolbar).toContain("md:flex-nowrap");
  });

  it("tiene l'altezza fissa solo da md, dove allinea la tabella", () => {
    expect(toolbar).toContain("md:h-8");
    // `h-8` senza prefisso rimetterebbe l'altezza fissa anche su mobile, e
    // la seconda riga uscirebbe dal riquadro invece di allargarlo.
    expect(toolbar).not.toMatch(/(?:^|\s)h-8(?:\s|")/);
  });
});
