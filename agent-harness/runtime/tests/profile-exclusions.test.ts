/**
 * The exclusions of the profile the user accepted (JHT-T24), in the runtime against the Python it
 * copies: the score takes the same penalty off the same total with the same line on top, the Scout's
 * hint reads the same, and nothing the user wrote gets in.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { createDbTools } from "../src/db/tools.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();
const context = {} as ToolContext;
const VIABLE = "name: Ada Example\ntarget_role: Backend Engineer\nskills: [go, sql]\n";
const SENTINEL = "SENTINEL-PRIVATE-WORDS-OF-THE-USER";
const NONCE = "c0ffee42";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-profile-exclusions-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function home(): string {
  const dir = join(root, `home-${Math.random()}`);
  mkdirSync(join(dir, "profile"), { recursive: true });
  writeFileSync(join(dir, "profile", "candidate_profile.yml"), VIABLE);
  return dir;
}

/** Positions: 1 Acme/FR/Backend/EUR 30000, 2 Globex/DE/Data/EUR 90000, 3 Acme/FR/remote, 4 Acme/FR/Other. */
function seeded(path: string, rules: Array<[string, string, string]>): Database {
  const db = openJobsDb(path);
  db.exec("INSERT INTO companies (name) VALUES ('Acme'), ('Globex')");
  const add = db.prepare(
    "INSERT INTO positions (title, company, company_id, url, status, loc_country_code, role_family, remote_type, work_mode, salary_estimated_max, salary_estimated_currency) VALUES (?, ?, ?, ?, 'checked', ?, ?, ?, ?, ?, ?)",
  );
  add.run("One", "Acme", 1, "https://a.example/1", "FR", "Backend", null, null, 30000, "EUR");
  add.run("Two", "Globex", 2, "https://g.example/2", "DE", "Data", null, null, 90000, "EUR");
  add.run("Three", "Acme", 1, "https://a.example/3", "FR", "Backend", "full_remote", "remote", null, null);
  add.run("Four", "Acme", 1, "https://a.example/4", "FR", "Other", null, null, 30000, "USD");
  const rule = db.prepare("INSERT INTO profile_exclusions (code, status, params) VALUES (?, ?, ?)");
  for (const [code, status, params] of rules) rule.run(code, status, params);
  return db;
}

const COMPANY: [string, string, string] = ["company", "active", '{"company_ids":[1]}'];
const LOCATION: [string, string, string] = ["wrong_location", "active", '{"country_codes":["FR"]}'];
const SALARY: [string, string, string] = ["salary_low", "active", '{"ceilings":{"EUR":40000}}'];
const STACK: [string, string, string] = ["wrong_stack", "active", '{"role_families":["Backend"]}'];

function tool(db: Database, name: "db_insert" | "db_query", agent: string, homeDir: string) {
  const list = createDbTools({ db: () => db, agent, profilePath: join(homeDir, "profile", "candidate_profile.yml"), nonce: () => NONCE });
  const t = list.find((x) => x.spec.name === name) as ToolHandler;
  return (args: string[]) => t.execute(t.spec.schema.parse({ args }), context);
}

const score = (id: number, total = 80) => [
  "score", "--position-id", String(id), "--total", String(total), "--stack-match", "30", "--remote-fit", "20",
  "--salary-fit", "10", "--experience-fit", "7", "--strategic-fit", "5", "--breakdown", "STACK: ok\nREMOTE: ok", "--notes", "n",
];

function scores(db: Database) {
  return (db.prepare("SELECT * FROM scores ORDER BY id").all() as Record<string, unknown>[]).map((r) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => !/_at$/.test(k) && k !== "scored_by")),
  );
}

const SCENARIOS: Array<{ label: string; rules: Array<[string, string, string]>; ids: number[]; total?: number }> = [
  { label: "the company: -30 on its position, none on another", rules: [COMPANY], ids: [1, 2] },
  { label: "wrong location -15, and not on a fully remote position", rules: [LOCATION], ids: [1, 3, 2] },
  { label: "salary too low by currency", rules: [SALARY], ids: [1, 2, 4] },
  { label: "wrong stack, never the catch-all", rules: [STACK], ids: [1, 4, 2] },
  { label: "several codes: the sum stops at 30", rules: [LOCATION, SALARY, STACK], ids: [1] },
  { label: "a withdrawn rule does not act", rules: [["company", "withdrawn", '{"company_ids":[1]}']], ids: [1] },
  { label: "never below zero", rules: [COMPANY], ids: [1], total: 10 },
  { label: "a rule nobody can read acts as none", rules: [["company", "active", "not json"]], ids: [1] },
];

describe("db_insert score with exclusions, against db_insert.py", () => {
  it.skipIf(skills === null).each(SCENARIOS)("$label", async ({ rules, ids, total }) => {
    const homeDir = home();
    const pyPath = join(root, "py.db");
    const pyDb = seeded(pyPath, rules);
    const ourDb = seeded(join(root, "ours.db"), rules);
    const insert = tool(ourDb, "db_insert", "scorer-1", homeDir);
    for (const id of ids) {
      const argv = score(id, total);
      const py = runPython(skills!, ["db_insert.py", ...argv], { JHT_DB: pyPath, JHT_HOME: homeDir, JHT_AGENT_NAME: "scorer-1" });
      const ours = await insert(argv);
      expect(py.status).toBe(0);
      expect(ours.ok).toBe(true);
      expect(ours.content).toBe(py.stdout.trimEnd());
    }
    expect(scores(ourDb)).toEqual(scores(pyDb));
  });

  it("puts the penalty on the total and the line first, and leaves the components alone", async () => {
    const db = seeded(join(root, "n.db"), [COMPANY]);
    const insert = tool(db, "db_insert", "scorer-1", home());
    const done = await insert(score(1));
    expect(done.content).toContain("Profile exclusion: -30 (company), 80 -> 50");
    expect(db.prepare("SELECT total_score, stack_match, breakdown FROM scores").get()).toEqual({
      total_score: 50,
      stack_match: 30,
      breakdown: "EXCLUSION -30: unwanted company (company)\nSTACK: ok\nREMOTE: ok",
    });
  });
});

describe("db_query profile-exclusions, against db_query.py", () => {
  it.skipIf(skills === null).each([[[]], [["--json"]]])("the Scout's hint %j", (flags) => {
    const pyPath = join(root, "py.db");
    const pyDb = seeded(pyPath, [COMPANY, LOCATION, SALARY, STACK]);
    const ourDb = seeded(join(root, "ours.db"), [COMPANY, LOCATION, SALARY, STACK]);
    const py = runPython(skills!, ["db_query.py", "profile-exclusions", ...flags], { JHT_DB: pyPath, JHT_AGENT_NAME: "scout-1", JHT_EXTERNAL_CONTENT_NONCE: NONCE });
    return tool(ourDb, "db_query", "scout-1", home())(["profile-exclusions", ...flags]).then((ours) => {
      expect(py.status).toBe(0);
      expect(ours.content).toBe(py.stdout.trimEnd());
      if (flags.length === 0) expect(ours.content).toContain("SC-04");
      pyDb.close();
    });
  });

  it("says so when nothing is in force, and only the Scout (and the roles that read widely) may ask", async () => {
    const db = seeded(join(root, "e.db"), []);
    expect((await tool(db, "db_query", "scout-1", home())(["profile-exclusions"])).content).toBe("No profile exclusions in force.");
    const scorer = await tool(db, "db_query", "scorer-1", home())(["profile-exclusions"]);
    expect(scorer.ok).toBe(false);
  });

  it("never shows a word the user wrote", async () => {
    const db = seeded(join(root, "s.db"), [COMPANY]);
    db.exec(`INSERT INTO position_feedback (position_id, action, reason, note) VALUES (1, 'dislike', 'company', '${SENTINEL}')`);
    const insert = tool(db, "db_insert", "scorer-1", home());
    const query = tool(db, "db_query", "scout-1", home());
    const texts = [(await query(["profile-exclusions"])).content, (await query(["profile-exclusions", "--json"])).content, (await insert(score(1))).content];
    texts.push(JSON.stringify(db.prepare("SELECT breakdown, notes FROM scores").all()));
    for (const text of texts) expect(text).not.toContain(SENTINEL);
  });
});
