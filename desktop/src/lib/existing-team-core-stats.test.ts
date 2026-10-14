import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The `stats` op of the reader the core runs on the team's VPS
// (POSITIONS_READ_PY in src-tauri/src/existing_team_runtime.rs), run for real on
// synthetic databases: the counts the dashboard shows, with their denominators,
// NULLs and unscored rows included, and a reply that stays under the 2 MiB the
// core accepts back however many rows the team has.
const CORE_REPLY_CAP = 2 * 1024 * 1024;
const python = spawnSync("python3", ["-I", "-c", "import sqlite3"]);
const available = python.status === 0;

// vitest runs from desktop/
const SOURCE = readFileSync(resolve(process.cwd(), "src-tauri/src/existing_team_runtime.rs"), "utf8");
const READER = /const POSITIONS_READ_PY: &str = r#"([\s\S]*?)"#;/.exec(SOURCE)?.[1] ?? "";

type Seed = {
  id: number;
  status: string | null;
  source: string | null;
  role_family: string | null;
  title: string;
  found_at: string;
  write_requested: number;
  score: number | null | "none"; // "none": no scores row at all
  scored_at?: string | null;
  critic?: number | null;
  applied_at?: string | null;
  response?: string | null;
  response_at?: string | null;
  salary_min?: number | null;
  est_min?: number | null;
  currency?: string | null;
};

const SETUP = `
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
create table positions(id integer primary key, legacy_id integer, title text, company text, company_id integer,
  location text, remote_type text, status text, source text, role_family text, loc_country text, loc_city text,
  found_at text, found_by text, last_checked text, write_requested integer, jd_text text,
  salary_declared_min real, salary_declared_max real, salary_declared_currency text,
  salary_estimated_min real, salary_estimated_max real, salary_estimated_currency text);
create table scores(id integer primary key, position_id integer, total_score real, scored_at text, scored_by text);
create table applications(id integer primary key, position_id integer, critic_score real, critic_verdict text,
  written_at text, written_by text, applied_at text, response text, response_at text);
""")
for r in json.load(open(sys.argv[2])):
    db.execute("insert into positions values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        r["id"], None, r["title"], "Synthetic Co", None, None, "remote", r["status"], r["source"], r["role_family"],
        "AA" if r["id"] % 3 else None, "Alpha" if r["id"] % 2 else None, r["found_at"], "scout-1", None,
        r["write_requested"], r.get("jd_text"), r.get("salary_min"), None, r.get("currency"), r.get("est_min"), None, "EUR"))
    if r["score"] != "none":
        db.execute("insert into scores values(?,?,?,?,?)", (r["id"], r["id"], r["score"], r.get("scored_at"), "scorer-1"))
    if r.get("critic") is not None or r.get("applied_at"):
        db.execute("insert into applications values(?,?,?,?,?,?,?,?,?)", (
            r["id"], r["id"], r.get("critic"), "PASS" if r.get("critic") is not None else None, None, "writer-1",
            r.get("applied_at"), r.get("response"), r.get("response_at")))
db.commit()
`;

const dirs: string[] = [];

function makeReader(seed: Seed[]): string {
  const dir = mkdtempSync(join(tmpdir(), "jht-core-stats-"));
  dirs.push(dir);
  const database = join(dir, "jobs.db");
  const seedFile = join(dir, "seed.json");
  writeFileSync(seedFile, JSON.stringify(seed));
  expect(spawnSync("python3", ["-I", "-c", SETUP, database, seedFile]).status).toBe(0);
  const reader = join(dir, "reader.py");
  writeFileSync(reader, READER.replace("file:/jht_home/jobs.db?mode=ro", `file:${database}?mode=ro`));
  return reader;
}

function stats(reader: string): { bytes: number; data: any } {
  const run = spawnSync("python3", ["-I", reader], {
    input: `${JSON.stringify({ op: "stats" })}\n`,
    maxBuffer: 256 * 1024 * 1024,
  });
  expect(run.status, String(run.stderr)).toBe(0);
  const reply = JSON.parse(run.stdout.toString("utf8"));
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  return { bytes: run.stdout.length, data: reply.data };
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const day = (n: number) => `2026-01-${String(1 + (n % 28)).padStart(2, "0")}T10:00:00Z`;

// A small team, written out so the expected numbers are checkable by hand.
const SMALL: Seed[] = [
  // status, source, family, score (null = a scores row with no value, "none" = no scores row)
  ...[
    ["new", "board-a", "Data", "none"],
    ["new", "board-a", null, "none"],
    ["checked", null, "Data", "none"],
    ["scored", "board-a", "Data", 90],
    ["scored", "board-b", "Data", 77],
    ["scored", "board-b", "Ops", 70],
    ["scored", "board-b", null, 55],
    ["scored", "board-c", "Ops", 40],
    ["scored", "board-c", "Ops", 0],
    ["scored", "board-c", "Ops", null],
    ["writing", "board-a", "Data", 80],
    ["review", "board-a", "Ops", 65],
    ["ready", "board-b", "Data", 61],
    ["applied", "board-a", "Data", 76],
    ["response", "board-a", "Ops", 100],
    ["excluded", "board-a", "Data", 30],
    ["excluded", "board-z", "Ops", "none"],
    [null, "board-a", "Data", "none"],
  ].map(([status, source, role_family, score], index): Seed => ({
    id: 1000 + index,
    status: status as string | null,
    source: source as string | null,
    role_family: role_family as string | null,
    title: `Synthetic role ${index}`,
    found_at: day(index),
    // wanted CV: 2 scored, 1 writing, 1 review; a ready and an excluded one are counted nowhere
    write_requested: [3, 4, 10, 11, 12, 15].includes(index) ? 1 : 0,
    score: score as number | null | "none",
    scored_at: score === "none" || score === null ? null : `2026-02-${String(1 + index).padStart(2, "0")}T08:00:00Z`,
    critic: index === 13 || index === 14 ? 8 : null,
    applied_at: index === 13 || index === 14 ? day(index + 3) : null,
    response: index === 14 ? "interview" : null,
    response_at: index === 14 ? day(index + 9) : null,
    salary_min: index === 3 ? 50000 : null,
    est_min: index === 4 ? 40000 : null,
    currency: index === 3 ? "USD" : null,
  })),
];

describe.skipIf(!available)("the core's `stats` op on a small team", () => {
  const reader = available ? makeReader(SMALL) : "";

  it("counts by status over every position, the excluded and the NULL status included in the total", () => {
    const { data } = stats(reader);
    expect(data.stats).toEqual({
      total: 18,
      new: 2,
      checked: 1,
      scored: 7,
      writing: 1,
      review: 1,
      ready: 1,
      applied: 1,
      excluded: 2,
      response: 1,
      // scored 7, 2 of them wanted (index 3 and 4) -> 5 open; wanted and still to write: 3,4 (scored), 10 (writing), 11 (review)
      scored_open: 5,
      to_write: 4,
    });
  });

  it("declares the denominators of the score distribution: active positions, those with a score, the average", () => {
    const { data } = stats(reader);
    // 18 - 2 excluded = 16 active; scores > 0 among them: 90 77 70 55 40 80 65 61 76 100
    expect(data.distribution.active).toBe(16);
    expect(data.distribution.withScore).toBe(10);
    expect(data.distribution.avgScore).toBe(71);
    expect(data.distribution.buckets).toEqual([
      { min: 76, max: 100, count: 5 }, // 90 77 80 76 100
      { min: 61, max: 75, count: 3 }, // 70 65 61
      { min: 41, max: 60, count: 1 }, // 55
      { min: 0, max: 40, count: 1 }, // 40 (a score of 0 and a NULL score are not "with score")
    ]);
  });

  it("counts the sources and the types of the active positions, the unknown ones under their own name", () => {
    const { data } = stats(reader);
    expect(data.sources).toEqual([
      { source: "board-a", count: 8 },
      { source: "board-b", count: 4 },
      { source: "board-c", count: 3 },
      { source: "sconosciuta", count: 1 },
    ]);
    const byFamily = Object.fromEntries(data.types.map((t: any) => [String(t.role_family), t.count]));
    expect(byFamily).toEqual({ Data: 8, Ops: 6, null: 2 });
  });

  it("serves the newest scored positions, never an excluded or unscored one, as light rows", () => {
    const { data } = stats(reader);
    expect(data.recent).toHaveLength(8);
    const scoredAt = data.recent.map((row: any) => row.scored_at);
    expect(scoredAt).toEqual([...scoredAt].sort().reverse());
    for (const row of data.recent) {
      expect(row.status).not.toBe("excluded");
      expect(row.score).not.toBeNull();
      expect(row).not.toHaveProperty("jd_text");
    }
  });

  it("gives the charts one row per active position with the declared salary first, then the estimate", () => {
    const { data } = stats(reader);
    expect(data.points).toMatchObject({ included: 16, of: 16 });
    const byId = Object.fromEntries(data.points.rows.map((row: any) => [row.id, row]));
    expect(byId["1003"]).toMatchObject({ salary_min: 50000, salary_currency: "USD", score: 90 });
    expect(byId["1004"]).toMatchObject({ salary_min: 40000, salary_currency: "EUR" });
    expect(byId["1000"]).toMatchObject({ score: null, salary_min: null, last_action_by: "scout" });
    expect(data.points.rows.some((row: any) => row.status === "excluded")).toBe(false);
  });

  it("serves the application events: the submissions, their answers and when", () => {
    const { data } = stats(reader);
    expect(data.events).toMatchObject({ included: 2, of: 2 });
    expect(data.events.rows).toEqual([
      { appliedAt: day(16), response: null, responseAt: null },
      { appliedAt: day(17), response: "interview", responseAt: day(23) },
    ]);
  });
});

describe.skipIf(!available)("the core's `stats` op against its 2 MiB cap", () => {
  it("stays under the cap with thousands of heavy rows, and says how many it left out", () => {
    const heavy = "x".repeat(20_000);
    const many: Seed[] = Array.from({ length: 3500 }, (_unused, index) => ({
      id: 1 + index,
      status: index % 9 === 0 ? "excluded" : "scored",
      source: `board-${index % 7}`,
      role_family: `Family ${index % 11}`,
      title: `${heavy} ${index}`,
      jd_text: heavy,
      found_at: day(index),
      write_requested: 0,
      score: 40 + (index % 60),
      scored_at: day(index),
      critic: 5,
      applied_at: index % 2 ? day(index) : null,
      response: null,
      response_at: null,
    }));
    const { bytes, data } = stats(makeReader(many));
    const active = many.filter((row) => row.status !== "excluded").length;
    expect(bytes).toBeLessThan(CORE_REPLY_CAP / 1.5);
    expect(data.points.of).toBe(active);
    expect(data.points.included).toBe(2000);
    expect(data.points.rows).toHaveLength(2000);
    expect(data.events.of).toBe(1750);
    expect(data.events.included).toBe(1750);
    // a title is cut, never sent whole
    expect(Math.max(...data.points.rows.map((row: any) => row.title.length))).toBeLessThanOrEqual(120);
    // the totals are exact whatever the charts got
    expect(data.stats.total).toBe(3500);
    expect(data.distribution.active).toBe(active);
  }, 60_000);

  it("keeps only the newest events when there are more than it sends, and says so", () => {
    const rows: Seed[] = Array.from({ length: 3200 }, (_unused, index) => ({
      id: 1 + index,
      status: "applied",
      source: "board-a",
      role_family: "Data",
      title: `Synthetic role ${index}`,
      found_at: day(index),
      write_requested: 0,
      score: 50,
      scored_at: day(index),
      critic: 5,
      applied_at: `2026-03-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`,
    }));
    const { data } = stats(makeReader(rows));
    expect(data.events).toMatchObject({ included: 3000, of: 3200 });
    // the oldest 200 are the ones left out
    expect(data.events.rows[0].appliedAt).toBe(rows[200].applied_at);
    expect(data.events.rows.at(-1).appliedAt).toBe(rows[3199].applied_at);
  }, 60_000);

  it("answers a team with no application events and no scores", () => {
    const { data } = stats(
      makeReader([
        { id: 1, status: "new", source: null, role_family: null, title: "Synthetic", found_at: day(0), write_requested: 0, score: "none" },
      ]),
    );
    expect(data.stats.total).toBe(1);
    expect(data.distribution).toMatchObject({ active: 1, withScore: 0, avgScore: null });
    expect(data.events).toEqual({ rows: [], included: 0, of: 0 });
    expect(data.recent).toEqual([]);
  });
});
