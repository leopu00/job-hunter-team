/**
 * `db_insert score`, the SCORER's write (T15), against `db_insert.py score`:
 * the same profile, the same seeded database, the same command line; the
 * output, the exit code and the `scores` rows must match.
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

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-db-score-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** `$JHT_HOME` with the profile, or without one when `profile` is null. */
function jhtHome(profile: string | null): string {
  const home = join(root, `home-${Math.random()}`);
  mkdirSync(join(home, "profile"), { recursive: true });
  if (profile !== null) writeFileSync(join(home, "profile", "candidate_profile.yml"), profile);
  return home;
}

function seeded(path: string): Database {
  const db = openJobsDb(path);
  const add = db.prepare("INSERT INTO positions (title, company, url, status, found_by) VALUES (?, ?, ?, ?, ?)");
  add.run("Backend Developer", "Acme", "https://acme.example/jobs/1", "checked", "scout-1");
  add.run("Data Engineer", "Globex", "https://globex.example/jobs/2", "checked", "scout-2");
  return db;
}

function scoreTool(db: Database, home: string, agent = "scorer-1") {
  const list = createDbTools({ db: () => db, agent, profilePath: join(home, "profile", "candidate_profile.yml") });
  const tool = list.find((t) => t.spec.name === "db_insert") as ToolHandler;
  return (args: string[]) => tool.execute(tool.spec.schema.parse({ args }), context);
}

/** The scores rows minus the clock; `scored_by` apart, since the runtime writes the agent. */
function scores(db: Database) {
  return (db.prepare("SELECT * FROM scores ORDER BY id").all() as Record<string, unknown>[]).map((r) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => !/_at$/.test(k) && k !== "scored_by")),
  );
}

const SCORE = ["score", "--position-id", "1", "--total", "72", "--stack-match", "30", "--remote-fit", "20", "--salary-fit", "10",
  "--experience-fit", "7", "--strategic-fit", "5", "--breakdown", "STACK: Go\nREMOTE: hybrid", "--notes", "solid match", "--scored-by", "capitano"];

const CASES: Array<{ label: string; profile: string | null; runs: string[][] }> = [
  { label: "a score, as scorer.md writes it", profile: VIABLE, runs: [SCORE] },
  { label: "a re-score keeps the row", profile: VIABLE, runs: [SCORE, [...SCORE.slice(0, 4), "65", "--notes", "second look"]] },
  { label: "only the required flags", profile: VIABLE, runs: [["score", "--position-id", "2", "--total", "0"]] },
  { label: "total over 100", profile: VIABLE, runs: [["score", "--position-id", "1", "--total", "101"]] },
  { label: "stack_match over its cap", profile: VIABLE, runs: [["score", "--position-id", "1", "--total", "50", "--stack-match", "41"]] },
  { label: "a negative component", profile: VIABLE, runs: [["score", "--position-id", "1", "--total", "50", "--experience-fit", "-1"]] },
  { label: "no profile", profile: null, runs: [SCORE] },
  { label: "only target_role", profile: "target_role: Dev\n", runs: [SCORE] },
  { label: "template profile", profile: "name: Nome Cognome\ntarget_role: Dev\n", runs: [SCORE] },
  { label: "missing --total", profile: VIABLE, runs: [["score", "--position-id", "1"]] },
  { label: "a total that is not a number", profile: VIABLE, runs: [["score", "--position-id", "1", "--total", "high"]] },
];

describe("db_insert score against db_insert.py score", () => {
  it.skipIf(skills === null).each(CASES)("$label", async ({ profile, runs }) => {
    const home = jhtHome(profile);
    const pyPath = join(root, "py.db");
    const pyDb = seeded(pyPath);
    const ourDb = seeded(join(root, "ours.db"));
    const insert = scoreTool(ourDb, home);
    for (const argv of runs) {
      const py = runPython(skills!, ["db_insert.py", ...argv], { JHT_DB: pyPath, JHT_HOME: home, JHT_AGENT_NAME: "scorer-1" });
      const ours = await insert(argv);
      expect(ours.ok).toBe(py.status === 0);
      if (py.status === 2) {
        // argparse: the error line is the same; our usage line is shorter (argv.ts).
        expect(ours.content.split("\n").at(-2)).toBe(py.stderr.trim().split("\n").at(-1));
      } else {
        expect(ours.content).toBe(py.status === 0 ? py.stdout.trimEnd() : `${py.stdout.trimEnd()}\n(exit code ${py.status})`);
      }
    }
    expect(scores(ourDb)).toEqual(scores(pyDb));
  });
});

describe("db_insert score, native", () => {
  it("records the agent as scorer, whatever --scored-by said, and keeps the id on a re-score", async () => {
    const db = seeded(join(root, "s.db"));
    const insert = scoreTool(db, jhtHome(VIABLE));
    expect((await insert(SCORE)).ok).toBe(true);
    const first = db.prepare("SELECT id, scored_by FROM scores").get();
    expect(first).toEqual({ id: 1, scored_by: "scorer-1" });
    expect((await insert([...SCORE.slice(0, 4), "40"])).ok).toBe(true);
    expect(db.prepare("SELECT id, total_score FROM scores").all()).toEqual([{ id: 1, total_score: 40 }]);
  });

  it("refuses the maintenance flags and a runtime with no profile folder, writing nothing", async () => {
    const db = seeded(join(root, "m.db"));
    const insert = scoreTool(db, jhtHome(VIABLE));
    const rescore = await insert([...SCORE, "--action", "rescore"]);
    expect(rescore).toMatchObject({ ok: false, content: expect.stringContaining("--action: not available to this agent") });

    const tool = createDbTools({ db: () => db, agent: "scorer-1" }).find((t) => t.spec.name === "db_insert") as ToolHandler;
    const noProfile = await tool.execute({ args: SCORE }, context);
    expect(noProfile).toMatchObject({ ok: false, content: expect.stringContaining("SCORE REJECTED") });
    expect(db.prepare("SELECT count(*) AS n FROM scores").get()).toEqual({ n: 0 });
  });

  it("scores only a position in its queue, checked (S-1), and writes nothing else", async () => {
    const db = seeded(join(root, "f.db"));
    const insert = scoreTool(db, jhtHome(VIABLE));
    expect(await insert(["score", "--position-id", "99", "--total", "10"])).toMatchObject({
      ok: false,
      content: expect.stringContaining("SCORE REFUSED: position 99 does not exist."),
    });
    // Scored once while checked; then the position moves on and the score is frozen for the SCORER.
    expect((await insert(SCORE)).ok).toBe(true);
    for (const status of ["new", "scored", "writing", "ready", "applied", "excluded"]) {
      db.prepare("UPDATE positions SET status = ? WHERE id = 1").run(status);
      expect(await insert([...SCORE.slice(0, 4), "5"]), status).toMatchObject({
        ok: false,
        content: expect.stringContaining(`SCORE REFUSED: position 1 is '${status}', not 'checked'.`),
      });
    }
    expect(db.prepare("SELECT position_id, total_score FROM scores").all()).toEqual([{ position_id: 1, total_score: 72 }]);
  });

  it("is the SCORER's alone: the SCOUT and the ANALISTA are refused", async () => {
    const db = seeded(join(root, "r.db"));
    for (const agent of ["scout-1", "analista-1"]) {
      const result = await scoreTool(db, jhtHome(VIABLE), agent)(SCORE);
      expect(result).toMatchObject({ ok: false, content: expect.stringContaining("`db_insert score` is not available to this agent") });
    }
    // And the SCORER inserts nothing else.
    const position = await scoreTool(db, jhtHome(VIABLE))(["position", "--title", "T", "--company", "C", "--url", "https://c.example/1"]);
    expect(position).toMatchObject({ ok: false, content: expect.stringContaining("`db_insert position` is not available to this agent") });
    expect(db.prepare("SELECT count(*) AS n FROM scores").get()).toEqual({ n: 0 });
  });
});
