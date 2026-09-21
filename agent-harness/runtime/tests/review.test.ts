/**
 * T34: the CRITICO's review is written by the hub, with the hub's own uid.
 *
 * In the live chain the Critic runs inside the SCRITTORE's process and carries
 * its uid, and `critiche/` is not the SCRITTORE's to write: on 21/09 the loop
 * ran to the end and that folder stayed empty — the judgement existed only in
 * the trace. Opening the folder to the SCRITTORE would let the reviewed
 * rewrite its own review, so the hub writes it instead.
 *
 * What is checked here: the model never chooses a character of the path (the
 * company comes from the database, and a hostile one writes nothing outside
 * `critiche/`), a review never replaces the one before it, only the two roles
 * of the review loop may ask, and a verdict that reaches the database with no
 * review beside it says so out loud instead of passing in silence.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { HUB_PATHS } from "../src/hub/protocol.ts";
import { MAX_REVIEW_CHARS, reviewFileName, reviewPrefix, saveReview, verdictPosition } from "../src/hub/review.ts";
import { createHub } from "../src/hub/server.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const REPO_ROOT = join(RUNTIME, "..", "..");
const SCRITTORE = "w".repeat(40);
const SCOUT = "s".repeat(40);
const DAY = () => new Date("2026-09-21T09:00:00Z");

let root: string;
let userDir: string;
let db: Database;

/** A position to review, and the application the verdict lands on. */
function seed(company: string): Database {
  const database = openJobsDb(join(root, "jobs.db"));
  database
    .prepare("INSERT INTO positions (title, company, url, status, found_by) VALUES ('Backend Engineer', ?, 'https://acme.example/1', 'scored', 'scout-1')")
    .run(company);
  database.prepare("INSERT INTO applications (position_id, status, written_by) VALUES (1, 'review', 'scrittore-1')").run();
  return database;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-review-"));
  userDir = join(root, "user");
  mkdirSync(join(userDir, "cv"), { recursive: true });
  db = seed("Acme S.p.A.");
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const critiche = () => join(userDir, "critiche");
const written = () => (existsSync(critiche()) ? readdirSync(critiche()).sort() : []);

describe("the review the hub writes", () => {
  it("names it as the skill promises, from the company in the database", () => {
    const result = saveReview(db, { userDir, positionId: 1, text: "# Review\n\nSCORE: 6.5/10", now: DAY });
    expect(result).toMatchObject({ ok: true, path: join(critiche(), "review-acme-s-p-a-2026-09-21.md") });
    expect(readFileSync(result.path!, "utf8")).toBe("# Review\n\nSCORE: 6.5/10\n");
  });

  it("never replaces the one before it: the three rounds are the history", () => {
    const first = saveReview(db, { userDir, positionId: 1, text: "round 1", now: DAY });
    const second = saveReview(db, { userDir, positionId: 1, text: "round 2", now: DAY });
    const third = saveReview(db, { userDir, positionId: 1, text: "round 3", now: DAY });
    expect([first, second, third].map((r) => r.ok)).toEqual([true, true, true]);
    expect(written()).toEqual(["review-acme-s-p-a-2026-09-21-v2.md", "review-acme-s-p-a-2026-09-21-v3.md", "review-acme-s-p-a-2026-09-21.md"]);
    // Each file still holds its own round: nothing was overwritten.
    expect(readFileSync(first.path!, "utf8")).toBe("round 1\n");
    expect(readFileSync(third.path!, "utf8")).toBe("round 3\n");
  });

  it("writes nothing outside critiche/, whatever the job ad called the company", () => {
    // The company is a scraped string: it reaches the name as a slug or not at all.
    for (const company of ["../cv/CV_1.md", "/etc/passwd", "..", "Acme/../../..", "  ", "Ünïcødé & Co."]) {
      const hostile = mkdtempSync(join(tmpdir(), "jht-review-hostile-"));
      const ownDb = openJobsDb(join(hostile, "jobs.db"));
      ownDb.prepare("INSERT INTO positions (title, company, url, status, found_by) VALUES ('X', ?, 'https://x.example/1', 'scored', 'scout-1')").run(company);
      const out = join(hostile, "user");
      const result = saveReview(ownDb, { userDir: out, positionId: 1, text: "review", now: DAY });
      expect(result.ok, company).toBe(true);
      // Inside `critiche/`, one file, and its name has no separator in it.
      expect(dirname(result.path!)).toBe(join(out, "critiche"));
      expect(readdirSync(join(out, "critiche"))).toHaveLength(1);
      expect(result.path!.slice(join(out, "critiche").length + 1)).toMatch(/^review-[a-z0-9-]*-2026-09-21\.md$/);
      ownDb.close();
      rmSync(hostile, { recursive: true, force: true });
    }
  });

  it("refuses a folder that leaves the deliverables by a symlink", () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(userDir, { recursive: true });
    symlinkSync(elsewhere, critiche());
    expect(saveReview(db, { userDir, positionId: 1, text: "review", now: DAY })).toMatchObject({ ok: false, status_code: "PATH_REFUSED" });
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("creates nothing for a position that is not there, or a review past the cap", () => {
    expect(saveReview(db, { userDir, positionId: 99, text: "review", now: DAY })).toMatchObject({ ok: false, status_code: "NOT_FOUND" });
    expect(saveReview(db, { userDir, positionId: 1, text: "x".repeat(MAX_REVIEW_CHARS + 1), now: DAY })).toMatchObject({
      ok: false,
      status_code: "TOO_LONG",
    });
    expect(written()).toEqual([]);
  });

  it("names a review after the company and finds it again by the same slug", () => {
    expect(reviewFileName("Acme S.p.A.", "2026-09-21")).toBe("review-acme-s-p-a-2026-09-21.md");
    expect(reviewFileName("", "2026-09-21")).toBe("review-azienda-2026-09-21.md");
    // The name a file is written under and the prefix the hub looks for are
    // the same words: a verdict with its review beside it must not be told the
    // review is missing.
    expect(reviewFileName("Acme S.p.A.", "2026-09-21").startsWith(reviewPrefix("Acme S.p.A."))).toBe(true);
  });

  it("warns only for a verdict, not for every application update", () => {
    expect(verdictPosition("db_update", { args: ["application", "7", "--critic-verdict", "PASS"] })).toBe(7);
    expect(verdictPosition("db_update", { args: ["application", "7", "--critic-score", "8"] })).toBe(7);
    expect(verdictPosition("db_update", { args: ["application", "7", "--status", "review"] })).toBeNull();
    expect(verdictPosition("db_update", { args: ["position", "7", "--critic-verdict", "PASS"] })).toBeNull();
    expect(verdictPosition("db_query", { args: ["application", "7", "--critic-verdict", "PASS"] })).toBeNull();
    expect(verdictPosition("db_update", { args: [] })).toBeNull();
  });
});

describe("who may save a review", () => {
  let url: string;
  let close: () => Promise<void>;
  let dbPath: string;

  const hub = async (withUserDir = true) => {
    dbPath = join(root, "jobs.db");
    const server = createHub({
      tokens: new Map([
        [SCRITTORE, "scrittore-1"],
        [SCOUT, "scout-1"],
      ]),
      dbPath,
      channelsDir: join(root, "channels"),
      stateDir: join(root, "state"),
      appRoot: REPO_ROOT,
      ...(withUserDir ? { userDir } : {}),
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((done) => server.close(() => done()));
  };
  afterEach(() => close());

  const post = async (path: string, token: string, body: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it("takes it from the SCRITTORE whose process the Critic runs in, and from nobody else", async () => {
    await hub();
    const saved = await post(HUB_PATHS.review, SCRITTORE, { position_id: 1, text: "# Review\n\nSCORE: 7.2/10" });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ok: true, path: expect.stringContaining(join("critiche", "review-acme-s-p-a-")) });
    expect(readFileSync(String(saved.body["path"]), "utf8")).toContain("SCORE: 7.2/10");

    const scout = await post(HUB_PATHS.review, SCOUT, { position_id: 1, text: "not mine to write" });
    expect(scout.status).toBe(403);
    expect(written()).toHaveLength(1);
  });

  it("refuses a body with anything more, and says so when it has no deliverables folder", async () => {
    await hub();
    expect((await post(HUB_PATHS.review, SCRITTORE, { position_id: 1, text: "r", path: "/etc/x" })).status).toBe(400);
    expect((await post(HUB_PATHS.review, SCRITTORE, { position_id: 0, text: "r" })).status).toBe(400);
    await close();
    await hub(false);
    expect((await post(HUB_PATHS.review, SCRITTORE, { position_id: 1, text: "r" })).status).toBe(503);
  });

  it("says out loud when a verdict is recorded and no review is beside it", async () => {
    await hub();
    const verdict = { name: "db_update", args: { args: ["application", "1", "--critic-verdict", "NEEDS_WORK", "--critic-score", "7.2"] } };
    const silent = await post(HUB_PATHS.tool, SCRITTORE, verdict);
    expect(silent.status).toBe(200);
    expect(silent.body).toMatchObject({ ok: true });
    // The database write stands, and the answer names what is missing.
    expect(String(silent.body["content"])).toMatch(/no review file is in critiche\/ for position 1/);
    expect(String(silent.body["content"])).toContain("save_review");
    expect(openJobsDb(dbPath).prepare("SELECT critic_verdict FROM applications WHERE position_id = 1").get()).toEqual({ critic_verdict: "NEEDS_WORK" });

    // With the review saved first, the same call says nothing extra.
    await post(HUB_PATHS.review, SCRITTORE, { position_id: 1, text: "# Review" });
    const after = await post(HUB_PATHS.tool, SCRITTORE, verdict);
    expect(String(after.body["content"])).not.toMatch(/no review file/);
  });

});
