/**
 * T28: the person asks for a CV, and only the person can.
 *
 * Three things are checked here:
 * - the port answers what `shared/skills/write_request.py` answers, on the
 *   same database, case by case (skipped where python3 or the commit is not
 *   at hand — the image has neither);
 * - the way in is the host's: the operator's command, and on a live run the
 *   hub's path, which takes the team's token. A role's token is refused, and
 *   no tool of any role writes the column;
 * - the command is the one a person would type, end to end.
 */

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { requestWrite, type WriteRequestKind, type WriteRequestMode } from "../src/db/write-request.ts";
import { HUB_PATHS } from "../src/hub/protocol.ts";
import { createHub } from "../src/hub/server.ts";
import { pythonSkills, runPython, RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);
const SKILLS = pythonSkills();
const SCOUT = "s".repeat(40);
const TEAM = "t".repeat(40);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-write-request-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A database with four positions: one ready to be asked for (`scored`, no
 * application), one still `checked`, one already written, and one whose
 * application is in review — the four answers the script can give.
 */
function seed(path: string): Database {
  const db = openJobsDb(path);
  for (const [title, status] of [
    ["Backend Developer", "scored"],
    ["Platform Engineer", "checked"],
    ["Data Engineer", "scored"],
    ["Site Reliability", "scored"],
  ] as const) {
    db.prepare("INSERT INTO positions (title, company, url, status, found_by) VALUES (?, 'Acme', ?, ?, 'scout-1')").run(
      title,
      `https://acme.example/jobs/${title.replace(/\s/g, "-")}`,
      status,
    );
  }
  for (const id of [1, 2, 3, 4]) {
    db.prepare("INSERT INTO scores (position_id, total_score, scored_by) VALUES (?, ?, 'scorer-1')").run(id, 70 + id);
  }
  db.prepare("INSERT INTO applications (position_id, status, written_by) VALUES (3, 'review', 'scrittore-1')").run();
  return db;
}

describe("against shared/skills/write_request.py", () => {
  /** Every answer the script has, asked of both sides on their own copy of the same database. */
  const cases: Array<[string, number, WriteRequestMode, WriteRequestKind]> = [
    ["a CV on a scored position with no application", 1, "on", "cv"],
    ["the same request again", 1, "on", "cv"],
    ["a CV that is called off", 1, "off", "cv"],
    ["a position that is not there", 99, "on", "cv"],
    ["a CV on a position that is not scored", 2, "on", "cv"],
    ["a CV on a position whose application exists", 3, "on", "cv"],
    ["a cover letter without an application", 4, "on", "cover_letter"],
    ["a cover letter on an application", 3, "on", "cover_letter"],
    ["calling off a kind that is not the live one", 1, "off", "cover_letter"],
  ];

  for (const [name, id, mode, kind] of cases) {
    it.skipIf(SKILLS === null)(`answers as the script does for ${name}`, async () => {
      const ours = join(root, `ours-${id}-${mode}-${kind}.db`);
      const theirs = join(root, `theirs-${id}-${mode}-${kind}.db`);
      const db = seed(ours);
      seed(theirs).close();
      // The first case of each pair leaves a live request behind on purpose:
      // "the same request again" and "called off" are asked of a position
      // that was already asked for, on both sides alike.
      if (name.startsWith("the same") || name.startsWith("a CV that is called off") || name.startsWith("calling off")) {
        requestWrite(db, 1, "on", "cv");
        runPython(SKILLS!, [join(SKILLS!, "write_request.py"), "1"], { JHT_DB: theirs });
      }

      const mine = requestWrite(db, id, mode, kind);
      const script = runPython(SKILLS!, [join(SKILLS!, "write_request.py"), String(id), "--mode", mode, "--kind", kind], { JHT_DB: theirs });
      const said = JSON.parse(script.stdout.trim()) as Record<string, unknown>;

      // The script's `rework_reason` is the verdict of a check the harness does
      // not have ([JHT-CV-REWORK]); ours says so instead of pretending.
      const reason = mine.rework_reason;
      delete (said as { rework_reason?: unknown }).rework_reason;
      const { rework_reason: _ours, ...rest } = mine;
      expect(rest).toEqual(said);
      expect(script.status).toBe(mine.ok ? 0 : 1);
      if ("rework_reason" in mine) expect(reason).toMatch(/not available in the API harness/);

      // And both databases hold the same row afterwards.
      const columns = "write_requested, write_request_kind";
      const other = openJobsDb(theirs);
      expect(db.prepare(`SELECT ${columns} FROM positions WHERE id = ?`).get(id)).toEqual(
        other.prepare(`SELECT ${columns} FROM positions WHERE id = ?`).get(id),
      );
      other.close();
      db.close();
    });
  }
});

describe("the request itself", () => {
  it("keeps the queue's place when the same request is repeated, and moves it when the kind changes", () => {
    const db = seed(join(root, "queue.db"));
    expect(requestWrite(db, 1, "on", "cv")).toMatchObject({ ok: true, previous: 0, current: 1, kind: "cv" });
    const first = db.prepare("SELECT write_requested_at FROM positions WHERE id = 1").get() as { write_requested_at: string };
    expect(requestWrite(db, 1, "on", "cv")).toMatchObject({ ok: true, previous: 1, current: 1 });
    expect(db.prepare("SELECT write_requested_at FROM positions WHERE id = 1").get()).toEqual(first);

    expect(requestWrite(db, 3, "on", "cover_letter")).toMatchObject({ ok: true, current: 1, kind: "cover_letter" });
    expect(requestWrite(db, 3, "off", "cv")).toMatchObject({ ok: true, current: 1, kind: "cover_letter" });
    expect(requestWrite(db, 3, "off", "cover_letter")).toMatchObject({ ok: true, current: 0, kind: null });
    db.close();
  });

  it("writes nothing when it refuses", () => {
    const db = seed(join(root, "refused.db"));
    const before = db.prepare("SELECT write_requested, write_request_kind, updated_at FROM positions WHERE id = 2").get();
    expect(requestWrite(db, 2, "on", "cv")).toMatchObject({ ok: false, status_code: "BAD_STATUS" });
    expect(db.prepare("SELECT write_requested, write_request_kind, updated_at FROM positions WHERE id = 2").get()).toEqual(before);
    expect(requestWrite(db, 99, "on", "cv")).toMatchObject({ ok: false, status_code: "NOT_FOUND" });
    // A kind that is not one of the two never reaches a statement.
    expect(requestWrite(db, 1, "on", "whatever" as WriteRequestKind)).toMatchObject({ ok: false, status_code: "BAD_KIND" });
    expect(db.prepare("SELECT write_requested FROM positions WHERE id = 1").get()).toEqual({ write_requested: 0 });
    db.close();
  });

  it("is the only thing in the runtime that writes the column", () => {
    // The person asks; the team does not ask for itself. `db_update position`
    // never had the column, and this keeps it that way: a new writer has to
    // be added here on purpose.
    const sources = execFileSyncLines(["git", "grep", "-l", "--untracked", "write_requested", "--", "src"]);
    expect(sources.sort()).toEqual(["src/cli/user.ts", "src/db/db-query.ts", "src/db/schema.sql", "src/db/write-request.ts"]);
    for (const file of sources) {
      if (file === "src/db/write-request.ts" || file === "src/db/schema.sql") continue;
      // Everywhere else the column is read or spoken about, never set: what a
      // statement looks like is `SET write_requested` or a bound `= ?`.
      expect(readFileSync(join(RUNTIME, file), "utf8"), file).not.toMatch(/SET\s+write_requested|write_requested\s*=\s*\?/i);
    }
  });
});

describe("who may ask for a CV", () => {
  let url: string;
  let close: () => Promise<void>;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = join(root, "hub.db");
    seed(dbPath).close();
    const server = createHub({
      tokens: new Map([[SCOUT, "scout-1"]]),
      dbPath,
      channelsDir: join(root, "channels"),
      stateDir: join(root, "state"),
      appRoot: join(RUNTIME, "..", ".."),
      teamToken: TEAM,
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((done) => server.close(() => done()));
  });
  afterEach(() => close());

  const ask = async (token: string | undefined, body: unknown) => {
    const response = await fetch(`${url}${HUB_PATHS.userRequest}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it("takes the host's token and refuses a role's", async () => {
    expect(await ask(SCOUT, { position_id: 1 })).toMatchObject({ status: 403 });
    expect(await ask(undefined, { position_id: 1 })).toMatchObject({ status: 401 });
    const db = openJobsDb(dbPath);
    expect(db.prepare("SELECT write_requested FROM positions WHERE id = 1").get()).toEqual({ write_requested: 0 });

    expect(await ask(TEAM, { position_id: 1 })).toMatchObject({ status: 200, body: { ok: true, current: 1, kind: "cv" } });
    expect(db.prepare("SELECT write_requested, write_request_kind FROM positions WHERE id = 1").get()).toEqual({
      write_requested: 1,
      write_request_kind: "cv",
    });
    db.close();
  });

  it("takes only the three fields, and refuses a body with anything else", async () => {
    expect(await ask(TEAM, { position_id: 1, mode: "off", kind: "cv" })).toMatchObject({ status: 200, body: { ok: true, current: 0 } });
    expect(await ask(TEAM, { position_id: 1, table: "positions" })).toMatchObject({ status: 400 });
    expect(await ask(TEAM, { position_id: -1 })).toMatchObject({ status: 400 });
    expect(await ask(TEAM, { position_id: 2 })).toMatchObject({ status: 200, body: { ok: false, status_code: "BAD_STATUS" } });
  });

  it("is not a tool: no role can call it by name", async () => {
    const response = await fetch(`${url}${HUB_PATHS.tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SCOUT}` },
      body: JSON.stringify({ name: "write_request", args: { position_id: 1 } }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()) as { error: string }).toMatchObject({ error: expect.stringContaining("not a tool of scout-1") });
  });
});

describe("npm run user", () => {
  it("asks for a CV, says what happened and exits on the answer", async () => {
    const dbPath = join(root, "cli.db");
    seed(dbPath).close();
    const env = { ...process.env, JHT_API_DB: dbPath, JHT_API_HOME: join(root, "api") };

    const asked = await run("node", ["--experimental-strip-types", "--no-warnings", "src/cli/user.ts", "cv", "1"], { cwd: RUNTIME, env });
    expect(JSON.parse(asked.stdout.trim())).toMatchObject({ ok: true, id: 1, title: "Backend Developer", previous: 0, current: 1, kind: "cv" });
    const db = openJobsDb(dbPath);
    expect(db.prepare("SELECT write_requested, write_request_kind FROM positions WHERE id = 1").get()).toEqual({
      write_requested: 1,
      write_request_kind: "cv",
    });

    // A refusal comes back on stdout too, with exit 1: a host script reads it.
    const refused = await run("node", ["--experimental-strip-types", "--no-warnings", "src/cli/user.ts", "cv", "2"], { cwd: RUNTIME, env }).catch(
      (error: { code: number; stdout: string }) => error,
    );
    expect(refused).toMatchObject({ code: 1 });
    expect(JSON.parse((refused as { stdout: string }).stdout.trim())).toMatchObject({ ok: false, status_code: "BAD_STATUS" });

    // And the CAPITANO now sees the position in the writer's queue.
    expect(db.prepare("SELECT id FROM positions WHERE write_requested = 1").all()).toEqual([{ id: 1 }]);
    db.close();
  });

  it("says how it is used and writes nothing when the command is not one", async () => {
    const dbPath = join(root, "usage.db");
    seed(dbPath).close();
    const env = { ...process.env, JHT_API_DB: dbPath, JHT_API_HOME: join(root, "api") };
    for (const args of [["cv"], ["cv", "0"], ["cv", "one"], ["delete", "1"], []]) {
      const failed = await run("node", ["--experimental-strip-types", "--no-warnings", "src/cli/user.ts", ...args], { cwd: RUNTIME, env }).catch(
        (error: { code: number; stderr: string }) => error,
      );
      expect(failed, args.join(" ")).toMatchObject({ code: 2 });
      expect((failed as { stderr: string }).stderr).toContain("usage: npm run user");
    }
    const db = openJobsDb(dbPath);
    expect(db.prepare("SELECT COUNT(*) AS n FROM positions WHERE write_requested = 1").get()).toEqual({ n: 0 });
    db.close();
  });
});

/** `git grep -l` from the runtime, as a list of paths. */
function execFileSyncLines([file, ...args]: string[]): string[] {
  return execFileSync(file!, args, { cwd: RUNTIME, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim() !== "");
}
