/**
 * JHT-T130 — `/export` del sito e `jht export` offrivano sorgenti senza scrittore:
 * file JSON che nessun componente della squadra attuale scrive, quindi file vuoti,
 * con uno «zero» indistinguibile da una squadra che non ha fatto niente.
 *
 * Ora le sorgenti sono le tabelle vive di jobs.db, le stesse (e le stesse colonne)
 * dell'esportazione dell'app desktop, e queste prove guardano quattro cose:
 *   1. ogni sorgente offerta ha uno SCRITTORE, e le sue colonne esistono nello schema vero;
 *   2. la lista del sito e quella dell'app sono la stessa;
 *   3. la pagina offre esattamente quelle sorgenti;
 *   4. una sorgente ritirata si dice, non si esporta vuota.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  EXPORT_SOURCES,
  RETIRED_EXPORT_SOURCES,
  exportRange,
  readExportRows,
} from "../../../shared/export/sources.js";

const ROOT = resolve(__dirname, "../../..");
// Un sorgente letto con una regex su piu' righe: su Windows arriva con CRLF.
const text = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (name === "node_modules" || name === "dist") return [];
    if (statSync(join(ROOT, rel)).isDirectory()) return filesUnder(rel, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [rel] : [];
  });
}

const WRITER_FILES = [
  ...filesUnder("shared/skills", [".py"]),
  ...filesUnder("agent-harness/runtime/src", [".ts"]),
].map((rel) => ({ rel, body: text(rel) }));

describe("ogni sorgente offerta ha uno scrittore e colonne vere", () => {
  it.each(Object.entries(EXPORT_SOURCES))("%s", (_name, spec) => {
    const insert = new RegExp(`INSERT\\s+(?:OR\\s+[A-Z]+\\s+)?INTO\\s+${spec.table}\\b`);
    const writers = WRITER_FILES.filter((file) => insert.test(file.body)).map((file) => file.rel);
    expect(writers, `nessuno scrive ${spec.table}: una sorgente senza scrittore esporta file vuoti`).not.toEqual([]);
  });

  it("le colonne e la colonna della data esistono nello schema che _db.py crea davvero", () => {
    const script = [
      "import json, sqlite3, sys",
      "sys.path.insert(0, 'shared/skills')",
      "import _db",
      "db = sqlite3.connect(':memory:'); db.row_factory = sqlite3.Row",
      "_db.ensure_schema(db)",
      "tables = {t: [r[1] for r in db.execute(f'PRAGMA table_info({t})')] for t in json.loads(sys.argv[1])}",
      "print(json.dumps(tables))",
    ].join("\n");
    const tables = Object.values(EXPORT_SOURCES).map((spec) => spec.table);
    const home = mkdtempSync(join(tmpdir(), "jht-export-schema-"));
    try {
      const out = execFileSync("python3", ["-I", "-c", script, JSON.stringify(tables)], {
        cwd: ROOT,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", HOME: home, JHT_HOME: home },
      });
      const schema = JSON.parse(out) as Record<string, string[]>;
      for (const spec of Object.values(EXPORT_SOURCES)) {
        const have = schema[spec.table];
        expect(have.length, `la tabella ${spec.table} non esiste`).toBeGreaterThan(0);
        expect(spec.columns.filter((column) => !have.includes(column)), spec.table).toEqual([]);
        expect(have, spec.table).toContain(spec.dateColumn);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("nessuna colonna interna: percorsi, id di Drive, coordinate, credenziali", () => {
    const internal = /(^|_)(path|drive_id|lat|lon|token|secret|password|key|cloud_id)(_|$)/;
    for (const [name, spec] of Object.entries(EXPORT_SOURCES)) {
      expect(spec.columns.filter((column) => internal.test(column)), name).toEqual([]);
    }
  });
});

describe("il sito e l'app esportano le stesse sorgenti con le stesse colonne", () => {
  it("la lista dell'app (lo script Python di team_export.rs) e' quella condivisa", () => {
    const rust = text("desktop/src-tauri/src/team_export.rs");
    const found = [...rust.matchAll(/'(\w+)':\('(\w+)','(\w+)',\(([^)]*)\)\)/g)].map((match) => ({
      name: match[1],
      table: match[2],
      dateColumn: match[3],
      columns: [...match[4].matchAll(/'(\w+)'/g)].map((column) => column[1]),
    }));
    expect(found.map((spec) => spec.name)).toEqual(Object.keys(EXPORT_SOURCES));
    for (const spec of found) {
      expect(EXPORT_SOURCES[spec.name], spec.name).toEqual({
        table: spec.table,
        dateColumn: spec.dateColumn,
        columns: spec.columns,
      });
    }
  });

  it("la pagina /export offre esattamente quelle sorgenti, e nessuna ritirata", () => {
    const page = text("web/app/(protected)/export/page.tsx");
    const offered = [...page.matchAll(/^\s+id: "(\w+)",$/gm)].map((match) => match[1]);
    expect(offered).toEqual(Object.keys(EXPORT_SOURCES));
    for (const retired of Object.keys(RETIRED_EXPORT_SOURCES)) expect(offered).not.toContain(retired);
  });
});

describe("le sorgenti ritirate si dicono, non si esportano vuote", () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.exitCode = undefined;
  });

  it.each(Object.keys(RETIRED_EXPORT_SOURCES))("il sito risponde 410 per %s", async (source) => {
    vi.doMock("@/lib/auth", () => ({ requireAuth: async () => null }));
    vi.doMock("@/lib/db", () => ({
      getDb: () => {
        throw new Error("una sorgente ritirata non legge il database");
      },
    }));
    const { GET } = await import("@/app/api/export/route");
    const response = await GET({
      nextUrl: new URL(`http://localhost/api/export?source=${source}&format=json`),
    } as never);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ ok: false, code: "source_retired" });
  });

  it.each(Object.keys(RETIRED_EXPORT_SOURCES))("jht export %s lo dice ed esce 1, senza scrivere un file", async (source) => {
    const home = mkdtempSync(join(tmpdir(), "jht-export-retired-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const output = join(home, "out.json");
    try {
      const { handleExport } = await import("../../../cli/src/commands/export.js");
      await handleExport(source, { output });
      expect(process.exitCode).toBe(1);
      expect(error.mock.calls.flat().join("\n")).toContain("is not a data source any more");
      expect(() => readFileSync(output)).toThrow();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("readExportRows e il periodo", () => {
  function db(): DatabaseSync {
    const handle = new DatabaseSync(":memory:");
    handle.exec("CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, found_at TEXT, cv_path TEXT)");
    const insert = handle.prepare("INSERT INTO positions (title, found_at, cv_path) VALUES (?, ?, ?)");
    for (const [title, day] of [["A", "2026-03-01"], ["B", "2026-03-15T10:00:00Z"], ["C", "2026-03-31"], ["D", "2026-04-01"], ["E", null]]) {
      insert.run(title, day, "/x");
    }
    return handle;
  }
  const titles = (range: { since: string | null; until: string | null }) =>
    readExportRows(db(), "positions", range).rows.map((row) => row.title);

  it("senza periodo: tutte le righe, anche senza data; con periodo: `to` incluso", () => {
    expect(titles({ since: null, until: null })).toEqual(["A", "B", "C", "D", "E"]);
    expect(titles({ since: "2026-03-01", until: "2026-03-31" })).toEqual(["A", "B", "C"]);
    expect(titles({ since: "2026-03-15", until: "2026-03-15" })).toEqual(["B"]);
  });

  it("una colonna che il DB non ha e' lasciata fuori, una tabella assente e' zero righe", () => {
    const { columns, rows } = readExportRows(db(), "positions");
    expect(columns).toEqual(["id", "title", "found_at"]);
    expect(rows[0]).toEqual({ id: 1, title: "A", found_at: "2026-03-01" });
    const empty = new DatabaseSync(":memory:");
    expect(readExportRows(empty, "scores").rows).toEqual([]);
  });

  it("un periodo non valido non arriva mai al DB", () => {
    for (const bad of ["2026-3-1", "ieri", "2026-03-01'; DROP TABLE positions;--"]) {
      expect(exportRange(bad, null)).toBeNull();
      expect(exportRange(null, bad)).toBeNull();
    }
    expect(exportRange("2026-03-02", "2026-03-01")).toBeNull();
    expect(exportRange("2026-03-01", "2026-03-01")).toEqual({ since: "2026-03-01", until: "2026-03-01" });
  });
});
