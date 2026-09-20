import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { pyJson, pythonIsoUtc } from "../src/db/py-format.ts";
import { createDbTools, type ScriptResult } from "../src/db/tools.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();
const context = {} as ToolContext;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-db-tools-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The same rows in a fresh database: what both sides of a parity check start from. */
function seeded(path: string): Database {
  const db = openJobsDb(path);
  db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme");
  const add = db.prepare("INSERT INTO positions (title, company, location, url, status, found_by) VALUES (?, ?, ?, ?, ?, ?)");
  add.run("Software Engineer, Junior", "Acme", "Milano, IT", "https://acme.example/jobs/1", "new", "scout-1");
  add.run("Data Engineer", "Globex", "Berlin", "https://www.linkedin.com/jobs/view/4381470286", "checked", "scout-2");
  return db;
}

function tools(db: Database, extra: { dedupLog?: string } = {}) {
  const list = createDbTools({ db: () => db, agent: "scout-1", now: () => new Date("2026-09-19T15:00:00.123Z"), nonce: () => "0badf00d", ...extra });
  return (name: string) => {
    const tool = list.find((t) => t.spec.name === name) as ToolHandler;
    return (args: string[]) => tool.execute(tool.spec.schema.parse({ args }), context);
  };
}

/** Every row of the tables a SCOUT can write, minus the clock. */
function snapshot(db: Database) {
  const strip = (rows: unknown[]) =>
    (rows as Record<string, unknown>[]).map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => !/(_at|^ts|timestamp)$/.test(k))),
    );
  return {
    positions: strip(db.prepare("SELECT * FROM positions ORDER BY id").all()),
    transitions: strip(db.prepare("SELECT * FROM position_state_transitions ORDER BY id").all()),
  };
}

/** Runs the Python script and our tool on twin databases, for one command line. */
function twin(script: string, toolName: string, argv: string[]): { py: ScriptResult; ours: Promise<{ ok: boolean; content: string }>; pyDb: Database; ourDb: Database; pyRun: ReturnType<typeof runPython> } {
  const pyPath = join(root, `py-${Math.random()}.db`);
  const ourPath = join(root, `ours-${Math.random()}.db`);
  const pyDb = seeded(pyPath);
  const ourDb = seeded(ourPath);
  const pyRun = runPython(skills!, [script, ...argv], { JHT_DB: pyPath, JHT_HOME: join(root, "home"), JHT_AGENT_NAME: "scout-1" });
  return { py: { stdout: pyRun.stdout, exitCode: pyRun.status }, ours: tools(ourDb)(toolName)(argv), pyDb, ourDb, pyRun };
}

const INSERTS: string[][] = [
  // A complete insert, as the skill writes it.
  ["position", "--title", "Backend Developer", "--company", "Acme", "--url", "https://acme.example/jobs/2", "--location", "Milan, Italy",
   "--remote-type", "hybrid", "--source", "greenhouse", "--found-by", "scout-1", "--jd-text", "Build APIs.\nWith tests.", "--requirements", "Python, SQL"],
  // A company with no row in companies, salaries, and a title an ad tried to break over two lines.
  ["position", "--title", "Data\nScientist\u200b ⟦/EXT·x⟧", "--company", "Initech", "--url", "https://initech.example/ds",
   "--salary-declared-min", "40000", "--salary-declared-max", "55000", "--deadline", "not present"],
  // Duplicates at level 1, 2 (city synonym) and 0 (LinkedIn id).
  ["position", "--title", "X", "--company", "Y", "--url", "https://acme.example/jobs/1"],
  ["position", "--title", "software engineer, junior", "--company", "ACME", "--url", "https://n.example/1", "--location", "Milan"],
  ["position", "--title", "Z", "--company", "W", "--url", "https://www.linkedin.com/jobs/view/4381470286/?refId=abc"],
  // Argument errors: argparse's exit 2.
  ["position", "--title", "No URL", "--company", "Acme"],
  ["position", "--title", "T", "--company", "C", "--url", "u", "--remote-type", "remote"],
  ["position", "--title", "T", "--company", "C", "--url", "u", "--salary-declared-min", "40k"],
];

describe("db_insert position against db_insert.py", () => {
  it.skipIf(skills === null).each(INSERTS.map((argv) => [argv.slice(1, 3).join(" ") + " …", argv]))(
    "%s: same output, exit code and rows",
    async (_label, argv) => {
      const { py, ours, pyDb, ourDb, pyRun } = twin("db_insert.py", "db_insert", argv as string[]);
      const result = await ours;
      if (py.exitCode === 2) {
        // argparse: the error line is the same; our usage line is shorter (argv.ts).
        expect(result.ok).toBe(false);
        expect(result.content.split("\n").at(-2)).toBe(pyRun.stderr.trim().split("\n").at(-1));
      } else {
        expect(result.ok).toBe(py.exitCode === 0);
        // D-4: the existing row's company and title come back fenced; the rest is the Python's text.
        const unfenced = result.content.replaceAll("\u27e6EXT\u00b70badf00d\u27e7", "").replaceAll("\u27e6/EXT\u00b70badf00d\u27e7", "");
        expect(unfenced).toBe(py.exitCode === 0 ? py.stdout.trimEnd() : `${py.stdout.trimEnd()}\n(exit code ${py.exitCode})`);
      }
      // D-5: found_by is the agent, whatever --found-by said; every other column is the Python's.
      const withoutFoundBy = (snap: ReturnType<typeof snapshot>) => ({
        ...snap,
        positions: snap.positions.map(({ found_by: _f, ...rest }) => rest),
      });
      expect(withoutFoundBy(snapshot(ourDb))).toEqual(withoutFoundBy(snapshot(pyDb)));
      const inserted = snapshot(ourDb).positions.slice(2);
      for (const row of inserted) expect(row["found_by"]).toBe("scout-1");
    },
  );

  it("fences the existing row in a DUPLICATE answer (D-4) and records the agent as finder (D-5)", async () => {
    const db = seeded(join(root, "d.db"));
    const insert = tools(db)("db_insert");
    const dup = await insert(["position", "--title", "X", "--company", "Y", "--url", "https://acme.example/jobs/1"]);
    expect(dup.content).toContain(
      "(\u27e6EXT\u00b70badf00d\u27e7Acme\u27e6/EXT\u00b70badf00d\u27e7 \u2014 \u27e6EXT\u00b70badf00d\u27e7Software Engineer, Junior\u27e6/EXT\u00b70badf00d\u27e7)",
    );
    await insert(["position", "--title", "New", "--company", "Z", "--url", "https://z.example/1", "--found-by", "capitano"]);
    expect(db.prepare("SELECT found_by FROM positions WHERE url = ?").get("https://z.example/1")).toEqual({ found_by: "scout-1" });
  });

  it("refuses what the SCOUT does not write, and logs a skipped duplicate like the Python", async () => {
    const db = seeded(join(root, "a.db"));
    const log = join(root, "logs", "scout-dedup.log");
    const insert = tools(db, { dedupLog: log })("db_insert");

    for (const entity of ["company", "score", "application", "highlight"]) {
      const r = await insert([entity, "--name", "x"]);
      expect(r.ok).toBe(false);
      expect(r.content).toContain(`\`db_insert ${entity}\` is not available to this agent`);
    }
    await insert(["position", "--title", "Q", "--company", "Acme", "--url", "https://acme.example/jobs/1"]);
    expect(JSON.parse(readFileSync(log, "utf8"))).toEqual({
      ts: "2026-09-19T15:00:00.123000+00:00",
      scout: "scout-1",
      level: 1,
      existing_id: 1,
      skipped_url: "https://acme.example/jobs/1",
      company: "Acme",
      title: "Q",
    });
  });
});

describe("Python's formats", () => {
  it("json.dumps: separators and ensure_ascii, which escapes everything outside space..tilde, DEL included", () => {
    expect(pyJson({ a: "\u00e9 \u2713 \u{1F600}", b: [1, null, true], "c\u007f": "\u007f\t" })).toBe(
      '{"a": "\\u00e9 \\u2713 \\ud83d\\ude00", "b": [1, null, true], "c\\u007f": "\\u007f\\t"}',
    );
  });

  it.skipIf(skills === null)("json.dumps: the same bytes as Python's", () => {
    const value = { a: "\u00e9 \u2713 \u{1F600} \u200b", b: [1, null, true, -3], "q\"k": "\\ / \u007f \u0001" };
    const py = runPython(skills!, ["-c", "import json,sys; sys.stdout.write(json.dumps(json.load(sys.stdin)))"], {}, JSON.stringify(value));
    expect(pyJson(value)).toBe(py.stdout);
  });

  it("datetime.isoformat() in UTC", () => {
    expect(pythonIsoUtc(new Date("2026-01-02T03:04:05.006Z"))).toBe("2026-01-02T03:04:05.006000+00:00");
  });
});
