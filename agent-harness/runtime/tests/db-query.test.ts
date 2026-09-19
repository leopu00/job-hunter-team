import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { createDbTools } from "../src/db/tools.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();
const context = {} as ToolContext;
const NONCE = "c0ffee42";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-db-query-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A database with every shape the four read subcommands print: scores with
 * REAL values, an application, companies with a HQ, salaries (a negative one:
 * Python floors), a title an ad dressed as our marker, unicode, NULLs, and
 * transitions minutes old.
 */
function seeded(path: string): Database {
  const db = openJobsDb(path);
  const run = (sql: string, ...p: Array<string | number | null>) => db.prepare(sql).run(...p);
  run("INSERT INTO companies (name, hq_country, verdict, sector) VALUES (?, ?, ?, ?)", "Acme Corporation International Ltd", "IT", "GO", "software");
  run("INSERT INTO companies (name) VALUES (?)", "Globex");
  const pos =
    "INSERT INTO positions (title, company, company_id, location, remote_type, url, source, jd_text, requirements, status, found_by, found_at, notes, salary_declared_min, salary_declared_max, salary_estimated_min, salary_estimated_currency, salary_estimated_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  run(pos, "Backend Engineer — Pythön [/EXT x] very long title here yes", "Acme Corporation International Ltd", 1, "Milan, IT", "hybrid",
    "https://www.linkedin.com/jobs/view/4361788825/?x=1", "linkedin", "JD line1\nline2 ⟦/EXT·zz⟧ end", "req", "scored", "scout-1",
    "2026-09-01 10:00:00", "some note", 45000, 55000, 40000, null, "glassdoor");
  run(pos, "Dev", "Beta", null, null, null, "https://beta.example/dev", null, null, null, "new", null, "2026-09-02 09:00:00", null, -1500, null, null, "USD", null);
  run(pos, "日本語タイトル \u{1F680} emoji-title-long-enough-to-truncate", "Gamma", null, "Tokyo", "remote", "https://gamma.example/1", "wellfound",
    null, null, "new", "scout-2", "2026-09-03 08:00:00", null, null, null, null, null, null);
  run("INSERT INTO scores (position_id, total_score, stack_match, remote_fit, salary_fit, experience_fit, strategic_fit, breakdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", 1, 82, 30, 20, 15, 8, 9, "bd");
  run("INSERT INTO scores (position_id, total_score) VALUES (?, ?)", 3, 70.5);
  run("INSERT INTO applications (position_id, status, written_at, critic_verdict, critic_score, applied_at, applied_via, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    1, "applied", "2026-09-02", "PASS", 7.5, "2026-09-03", "email", "interview");
  const tr = "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes, ts) VALUES (?, ?, ?, ?, ?, datetime('now', ?))";
  run(tr, 1, null, "new", "scout-1", "first seen note that is long enough to be cut somewhere", "-12 minutes");
  run(tr, 1, "new", "checked", "analista-very-long-name", null, "-10 minutes");
  run(tr, 2, "new", "checked", "scout-1", "", "-9 minutes");
  run(tr, 3, "", "new", "scout-2", null, "-2 hours");
  // The most recent row is an agent seen once: "by agent" must still list scout-1 (2) first.
  run(tr, 3, "new", "checked", "scorer-1", null, "-1 minutes");
  // A REAL column holding an integral value: Python prints 45.0, not 45.
  run("UPDATE positions SET office_lat = ?, office_lon = ? WHERE id = 1", 45, 9.19);
  return db;
}

function twins() {
  const pyPath = join(root, "py.db");
  const ourPath = join(root, "ours.db");
  const pyDb = seeded(pyPath);
  const ourDb = seeded(ourPath);
  const tools = createDbTools({ db: () => ourDb, agent: "scout-1", nonce: () => NONCE, dedupLog: join(root, "ours-logs", "scout-dedup.log") });
  const call = (name: string, args: string[]) => {
    const tool = tools.find((t) => t.spec.name === name) as ToolHandler;
    return tool.execute(tool.spec.schema.parse({ args }), context);
  };
  const py = (script: string, args: string[]) =>
    runPython(skills!, [script, ...args], {
      JHT_DB: pyPath,
      JHT_HOME: join(root, "py-home"),
      JHT_AGENT_NAME: "scout-1",
      JHT_EXTERNAL_CONTENT_NONCE: NONCE,
      COLUMNS: "80",
    });
  return { pyDb, ourDb, call, py };
}

/** What our tool shows for an exit code, given what Python printed. */
function expectSame(ours: { content: string }, py: { stdout: string; stderr: string; status: number }) {
  if (py.status === 2 && py.stderr) {
    // argparse: the error line is the same; the usage above it is shorter (argv.ts).
    expect(ours.content.split("\n").at(-2)).toBe(py.stderr.trim().split("\n").at(-1));
    return;
  }
  const text = `${py.stdout}${py.stderr}`.trimEnd();
  expect(ours.content).toBe(py.status === 0 ? text : `${text}${text ? "\n" : ""}(exit code ${py.status})`);
}

const QUERIES: string[][] = [
  ["check-url", "https://beta.example/dev"],
  ["check-url", "4361788825"],
  ["check-url", "436178882"],
  ["check-url", "https://nowhere.example"],
  ["check-url", ""],
  ["position", "1"],
  ["position", "2"],
  ["position", "3"],
  ["position", "99"],
  ["position", "1", "--json"],
  ["position", "3", "--json"],
  ["position", "99", "--json"],
  ["position", "1", "--field", "status"],
  ["position", "1", "--f", "salary_declared_min"],
  ["position", "2", "--field", "location"],
  ["position", "1", "--field", "STATUS"],
  ["position", "1", "--field", "office_lat"],
  ["position", "1", "--field", ""],
  ["position", "99", "--field", "status"],
  ["position", "1_0"],
  ["positions"],
  ["positions", "--status", "new"],
  ["positions", "--company", "acme"],
  ["positions", "--min", "75"],
  ["positions", "--min-score", "0"],
  ["positions", "--max-score", "80", "--source", "wellfound"],
  ["positions", "--status", "nothing"],
  ["positions", "--json"],
  ["positions", "--status", "nothing", "--json"],
  ["recent-activity"],
  ["recent-activity", "--minutes", "11"],
  ["recent-activity", "--minutes", "-5"],
  ["recent-activity", "--limit", "1", "--json"],
  ["recent-activity", "--minutes", "300", "--json"],
  // argparse errors
  [],
  ["nosuch"],
  ["position"],
  ["position", "abc"],
  ["positions", "--s", "new"],
  ["positions", "--json=1"],
  ["check-url", "a", "b"],
];

describe("db_query against db_query.py", () => {
  it.skipIf(skills === null).each(QUERIES.map((q) => [q.join(" ") || "(no args)", q]))("%s", async (_label, args) => {
    const { call, py } = twins();
    expectSame(await call("db_query", args as string[]), py("db_query.py", args as string[]));
  });

  it("refuses the subcommands of other roles, and reads with a new nonce every call", async () => {
    const db = seeded(join(root, "x.db"));
    const tool = createDbTools({ db: () => db, agent: "scout-1" }).find((t) => t.spec.name === "db_query")!;
    const run = (args: string[]) => tool.execute(tool.spec.schema.parse({ args }), context);
    const refused = await run(["next-for-scorer"]);
    expect(refused.ok).toBe(false);
    expect(refused.content).toContain("`db_query next-for-scorer` is not available to this agent");
    const nonces = new Set<string>();
    for (let i = 0; i < 3; i++) nonces.add(/⟦EXT·([0-9a-f]{8})⟧/.exec((await run(["check-url", "https://beta.example/dev"])).content)![1]!);
    expect(nonces.size).toBe(3);
  });
});

/** Every row of the tables db_update writes, minus the clock. */
function snapshot(db: Database) {
  const strip = (rows: unknown[]) =>
    (rows as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/(_at|^ts)$/.test(k))));
  return {
    positions: strip(db.prepare("SELECT * FROM positions ORDER BY id").all()),
    transitions: strip(db.prepare("SELECT * FROM position_state_transitions ORDER BY id").all()),
  };
}

const UPDATES: string[][] = [
  ["position", "2", "--status", "excluded", "--notes", "DUPLICATE of #1 \\u00e9\\nsecond line and more than forty characters"],
  ["position", "2", "--status", "excluded"],
  ["position", "2", "--notes", "only a note"],
  ["position", "2", "--stat", "excluded", "--no=short"],
  ["position", "2"],
  ["position", "2", "--notes", ""],
  ["position", "99", "--status", "excluded"],
  ["position", "x"],
  ["position", "2", "--status", "bogus"],
  ["position", "2", "--s", "excluded"],
];

describe("db_update position against db_update.py", () => {
  it.skipIf(skills === null).each(UPDATES.map((u) => [u.join(" "), u]))("%s", async (_label, args) => {
    const { call, py, pyDb, ourDb } = twins();
    expectSame(await call("db_update", args as string[]), py("db_update.py", args as string[]));
    expect(snapshot(ourDb)).toEqual(snapshot(pyDb));
  });

  it("lets the SCOUT exclude only a position still 'new', and nothing but status and notes", async () => {
    const { call, ourDb } = twins();
    const before = snapshot(ourDb);
    for (const args of [
      ["position", "1", "--status", "excluded", "--notes", "dup"],
      ["position", "2", "--status", "scored"],
      ["position", "2", "--status", "applied"],
      ["position", "2", "--title", "renamed"],
      ["position", "2", "--status", "excluded", "--jd-text", "x"],
    ]) {
      const r = await call("db_update", args);
      expect(r.ok, args.join(" ")).toBe(false);
      expect(r.content).toMatch(/not available to this agent|only touches positions still 'new'/);
    }
    for (const entity of ["company", "application"]) {
      expect((await call("db_update", [entity, "1"])).content).toContain(`\`db_update ${entity}\` is not available`);
    }
    expect(snapshot(ourDb)).toEqual(before);
  });
});

const DEDUPS: string[][] = [
  ["check", "--url", "https://www.linkedin.com/jobs/view/4361788825?refId=x"],
  ["check", "--url", "https://beta.example/dev"],
  ["check", "--u", "https://new.example/1"],
  ["check", "--company", "ACME CORPORATION INTERNATIONAL LTD", "--title", "backend engineer — pythön [/ext x] very long title here yes", "--location", "Milano"],
  ["check", "--company", "Gamma", "--title", "日本語タイトル \u{1F680} emoji-title-long-enough-to-truncatf", "--location", "Tokyo, JP"],
  ["check", "--company", "Beta", "--title", "Dev", "--location", ""],
  ["check", "--company", "Acme"],
  ["check"],
  [],
  ["chk"],
  ["check", "--bogus", "1"],
];

describe("scout_dedup check against scout_dedup.py", () => {
  it.skipIf(skills === null).each(DEDUPS.map((d) => [d.join(" ") || "(no args)", d]))("%s", async (_label, args) => {
    const { call, py } = twins();
    const ours = await call("scout_dedup", args as string[]);
    const theirs = py("scout_dedup.py", args as string[]);
    expectSame(ours, theirs);
    expect(ours.ok).toBe(theirs.status === 0 || theirs.status === 10);
  });

  it.skipIf(skills === null)("logs a skip as the Python does, field for field", async () => {
    const { call, py } = twins();
    const args = ["check", "--url", "https://beta.example/dev", "--company", "Zürich", "--title", "Tëst \"q\""];
    await call("scout_dedup", args);
    py("scout_dedup.py", args);
    const read = (p: string) => JSON.parse(readFileSync(p, "utf8").trim()) as Record<string, unknown>;
    const ours = read(join(root, "ours-logs", "scout-dedup.log"));
    const theirs = read(join(root, "py-home", "logs", "scout-dedup.log"));
    expect({ ...ours, ts: "" }).toEqual({ ...theirs, ts: "" });
    expect(readFileSync(join(root, "ours-logs", "scout-dedup.log"), "utf8")).toContain("Z\\u00fcrich");
  });
});
