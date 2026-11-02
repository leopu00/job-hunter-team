/**
 * A position moves into `excluded` only with its reason in the notes: `EXCLUDED: [CATEGORY] <reason>`.
 *
 * The rule is `db_update.py`'s (`excluded_reason_ok`); the tool of the API team has the same one, and these tests keep the
 * two together: the same categories and the same words read from the Python source of this tree, the same answer to the
 * same command line, and the rule itself.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXCLUDE_CATEGORIES, EXCLUDE_HELP, excludedReasonOk } from "../src/db/db-update.ts";
import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { createDbTools } from "../src/db/tools.ts";
import type { ToolContext, ToolHandler } from "../src/tools/registry.ts";
import { pythonSkillsOfThisTree, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkillsOfThisTree();
const context = {} as ToolContext;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-excluded-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seeded(path: string): Database {
  const db = openJobsDb(path);
  db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme");
  const add = db.prepare("INSERT INTO positions (title, company, location, url, status, found_by) VALUES (?, ?, ?, ?, ?, ?)");
  add.run("Software Engineer", "Acme", "Milano, IT", "https://acme.example/jobs/1", "checked", "scout-1");
  add.run("Data Engineer", "Acme", "Berlin", "https://acme.example/jobs/2", "checked", "scout-1");
  return db;
}

function update(db: Database) {
  const list = createDbTools({ db: () => db, agent: "analista-1", now: () => new Date("2026-11-02T12:00:00.000Z"), nonce: () => "0badf00d" });
  const tool = list.find((t) => t.spec.name === "db_update") as ToolHandler;
  return async (args: string[]) => {
    const done = await tool.execute(tool.spec.schema.parse({ args }), context);
    return { ...done, toString: () => `${args.join(" ")} -> ${done.content}` };
  };
}

const REFUSED: (string | null)[] = [null, "non pertinente", "EXCLUDED: [GEO]", "EXCLUDED: [GEO]   ", "EXCLUDED: [WRONG] x", "EXCLUDED: [geo] x",
  "excluded: [GEO] x", "see EXCLUDED: [GEO] x", "[GEO] x", "ESCLUSA: x", "DUPLICATA di #abc"];
const ACCEPTED = [...EXCLUDE_CATEGORIES.map((c) => `EXCLUDED: [${c}] the specific reason`), "DUPLICATA di #12",
  "ESCLUSA: [LINK_MORTO] verified before writing", "[SCADUTO] page gone"];

describe("the reason of an exclusion", () => {
  it.each(REFUSED.map((n) => [String(n), n]))("%s is not a reason", (_label, notes) => {
    expect(excludedReasonOk(notes as string | null)).toBe(false);
  });

  it.each(ACCEPTED.map((n) => [n, n]))("%s is", (_label, notes) => {
    expect(excludedReasonOk(notes as string)).toBe(true);
  });

  it("is refused by the tool, with nothing written, and accepted with the reason", async () => {
    const db = seeded(join(root, "ours.db"));
    const run = update(db);
    for (const notes of REFUSED) {
      const args = ["position", "1", "--status", "excluded", "--title", "Renamed in the same command", ...(notes === null ? [] : ["--notes", notes])];
      const refused = await run(args);
      expect(refused.ok, String(notes)).toBe(false);
      expect(refused.content).toContain("EXCLUDED REJECTED");
      expect(db.prepare("SELECT status, notes, title FROM positions WHERE id = 1").get()).toEqual({ status: "checked", notes: null, title: "Software Engineer" });
    }
    expect((await run(["position", "1", "--status", "excluded", "--notes", "EXCLUDED: [DEAD_LINK] 404"])).ok).toBe(true);
    expect(db.prepare("SELECT status, notes FROM positions WHERE id = 1").get()).toEqual({ status: "excluded", notes: "EXCLUDED: [DEAD_LINK] 404" });
    db.close();
  });

  it("counts the notes already on the row", async () => {
    const db = seeded(join(root, "ours2.db"));
    const run = update(db);
    const step = async (args: string[], ok: boolean) => {
      const done = await run(args);
      expect(done.ok, `${args.join(" ")} -> ${done.content}`).toBe(ok);
    };
    await step(["position", "1", "--notes", "EXCLUDED: [SENIORITY] 8 years required"], true);
    await step(["position", "1", "--status", "excluded"], true);
    await step(["position", "2", "--notes", "just a remark"], true);
    await step(["position", "2", "--status", "excluded"], false);
    db.close();
  });

  it("does not ask for a reason on an edit that is not an exclusion", async () => {
    const db = seeded(join(root, "ours3.db"));
    const run = update(db);
    for (const args of [["position", "1", "--title", "Plain edit"], ["position", "2", "--notes", "a remark, not an exclusion"]]) {
      const done = await run(args);
      expect(done.ok, `${args.join(" ")} -> ${done.content}`).toBe(true);
    }
    db.close();
  });
});

describe("against db_update.py of this tree", () => {
  it.skipIf(skills === null)("has the same categories and the same words", () => {
    const run = runPython(skills!, ["-c", "import json, db_update as d; print(json.dumps([list(d.EXCLUDE_CATEGORIES), d.EXCLUDE_HELP]))"]);
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([[...EXCLUDE_CATEGORIES], EXCLUDE_HELP]);
  });

  it.skipIf(skills === null).each(REFUSED.concat(ACCEPTED).map((n) => [String(n), n]))("answers %s as the script does", async (_label, notes) => {
    const pyPath = join(root, `py-${Math.random()}.db`);
    const ourPath = join(root, `ours-${Math.random()}.db`);
    const pyDb = seeded(pyPath);
    const ourDb = seeded(ourPath);
    const argv = ["position", "1", "--status", "excluded", ...(notes === null ? [] : ["--notes", notes as string])];
    const py = runPython(skills!, ["db_update.py", ...argv], { JHT_DB: pyPath, JHT_HOME: join(root, "home"), JHT_AGENT_NAME: "analista-1" });
    const ours = await update(ourDb)(argv);
    expect(ours.ok).toBe(py.status === 0);
    if (py.status !== 0) expect(ours.content).toContain(py.stderr.trim());
    const row = (db: Database) => db.prepare("SELECT status, notes FROM positions WHERE id = 1").get();
    expect(row(ourDb)).toEqual(row(pyDb));
    pyDb.close();
    ourDb.close();
  });
});
