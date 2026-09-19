import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { deadlineExtract } from "../src/parity/skills/deadline-extract.ts";
import { EnrichmentPolicy } from "../src/db/enrichment-policy.ts";
import { enrichmentPolicyCommand } from "../src/parity/skills/enrichment-policy.ts";
import { roleRegistry } from "../src/parity/skills/role-registry.ts";
import { salaryEstimate } from "../src/parity/skills/salary-estimate.ts";
import { ticketCommand } from "../src/parity/skills/ticket.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();

/** 2026-09-19, the day the parity was checked: both sides are given it. */
const TODAY = new Date(2026, 8, 19, 12, 0, 0);

const JDS = [
  "Apply by 2026-10-15 please",
  "deadline 2026-01-15 then 2026-12-01",
  "Deadline: June 15, 2027",
  "deadline: june 15",
  "closing date 15 settembre",
  "Scade il 3 ottobre 2026",
  "until 30/09/2026 or 01/10/26",
  "until 31/02/2027",
  "Expires in 30 days",
  "scade fra 10 giorni",
  "closes 5 days",
  "The role closes in ٣٠ days",
  "date: ٢٠٢٦-١١-٠١",
  "mayday 5 events",
  "maggio 12 2027 — may 12",
  "15 Sept 2026",
  "sept 31",
  "feb 29",
  "applications close on Friday",
  "",
  "   \n\t  ",
  "x2026-10-15",
  "ref_2026-10-15",
  "2026-10-15é",
  "expires in 99999 days",
  "expires in 9999999999 days",
];

describe("deadline_extract against deadline_extract.py", () => {
  it.skipIf(skills === null).each(JDS.map((jd) => [JSON.stringify(jd), jd]))("%s", (_label, jd) => {
    const py = runPython(skills!, [
      "-c",
      "import datetime, sys, deadline_extract as d\nd._today = lambda: datetime.date(2026, 9, 19)\nsys.exit(d.main(sys.argv[1:]))",
      "--jd",
      jd as string,
    ], {}, "");
    let ours: { stdout: string; exitCode: number };
    try {
      ours = deadlineExtract(["--jd", jd as string], TODAY);
    } catch {
      ours = { stdout: "", exitCode: 1 };
    }
    expect([ours.exitCode, ours.exitCode === 0 ? ours.stdout : ""]).toEqual([py.status, py.status === 0 ? py.stdout : ""]);
  });

  it("reads no stdin: a missing or empty --jd is an empty JD", () => {
    expect(deadlineExtract([], TODAY)).toEqual({ stdout: "\n", exitCode: 0 });
    expect(deadlineExtract(["--jd", ""], TODAY)).toEqual({ stdout: "\n", exitCode: 0 });
  });
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-analista-tools-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Tickets of every shape the three subcommands meet: held by us, by another, open, a rescore with and without a newer score. */
function ticketDb(path: string): Database {
  const db = openJobsDb(path);
  const run = (sql: string, ...p: Array<string | number | null>) => db.prepare(sql).run(...p);
  run("INSERT INTO positions (title, company, url, status) VALUES ('A', 'X', 'https://x.example/1', 'checked')");
  run("INSERT INTO positions (title, company, url, status) VALUES ('B', 'Y', 'https://x.example/2', 'scored')");
  run("INSERT INTO positions (title, company, url, status) VALUES ('C', 'Z', 'https://x.example/3', 'scored')");
  const t = "INSERT INTO position_tickets (position_id, request_text, kind, status, assigned_agent, response_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)";
  run(t, 1, "Is this still open?\nAnd remote?", "custom", "assigned", "analista-1", null, "2026-09-18 10:00:00");
  run(t, 1, "Check the company", "custom", "assigned", "ANALISTA-2", null, "2026-09-18 10:00:00");
  run(t, 2, "Rescore it", "rescore", "assigned", "analista-1", null, "2026-09-18 10:00:00");
  run(t, 1, "Old one", "", "resolved", "analista", "Done before.", "2026-09-01 10:00:00");
  run(t, 3, "Rescore, scored since", "rescore", "assigned", "analista-1", null, "2026-09-10 10:00:00");
  run("INSERT INTO scores (position_id, total_score, scored_at) VALUES (3, 70, '2026-09-12 10:00:00')");
  run(t, 1, "Nobody has it", "custom", "open", null, null, "2026-09-18 10:00:00");
  return db;
}

/** A snapshot without the clock `touch` and `resolve` write. */
const tickets = (db: Database) =>
  db.prepare("SELECT id, status, assigned_agent, response_text, resolved_at IS NOT NULL AS resolved FROM position_tickets ORDER BY id").all();

const TICKETS: string[][] = [
  ["show", "1"],
  ["show", "3"],
  ["show", "4"],
  ["show", "99"],
  ["show", "x"],
  ["touch", "1"],
  ["resolve", "1", "--response", "  Still open, fully remote.  "],
  ["resolve", "1", "--response", "   "],
  ["resolve", "3", "--response", "rescored"],
  ["resolve", "5", "--response", "rescored"],
  ["resolve", "4", "--response", "again"],
  ["resolve", "99", "--response", "x"],
  ["resolve", "1"],
  [],
  ["close", "1"],
];

describe("ticket against ticket.py, on tickets this agent holds", () => {
  it.skipIf(skills === null).each(TICKETS.map((t) => [t.join(" ") || "(no args)", t]))("%s", (_label, args) => {
    const pyDb = ticketDb(join(root, "py.db"));
    const ourDb = ticketDb(join(root, "ours.db"));
    let ours;
    try {
      ours = ticketCommand(() => ourDb, "analista-1", args as string[]);
    } catch (error) {
      ours = { stdout: "", stderr: `${(error as Error).message}\n`, exitCode: 2 };
    }
    const py = runPython(skills!, ["ticket.py", ...(args as string[])], { JHT_DB: join(root, "py.db") });
    if (py.status === 2) {
      expect(ours.exitCode).toBe(2);
      expect((ours.stderr ?? "").trim().split("\n").at(-1)).toBe(py.stderr.trim().split("\n").at(-1));
    } else {
      expect({ stdout: ours.stdout, stderr: ours.stderr ?? "", exit: ours.exitCode }).toEqual({ stdout: py.stdout, stderr: py.stderr, exit: py.status });
    }
    expect(tickets(ourDb)).toEqual(tickets(pyDb));
  });

  it("touches and resolves only tickets assigned to this agent, and none of the Capitano's subcommands", () => {
    const db = ticketDb(join(root, "x.db"));
    const before = tickets(db);
    for (const args of [["touch", "2"], ["resolve", "2", "--response", "mine now"], ["resolve", "6", "--response", "x"], ["touch", "6"]]) {
      const r = ticketCommand(() => db, "analista-1", args);
      expect([r.exitCode, r.stderr], args.join(" ")).toEqual([1, expect.stringMatching(/not to you/)]);
    }
    for (const sub of ["open", "assign", "list-open", "count-open", "for-position"]) {
      expect(ticketCommand(() => db, "analista-1", [sub, "1"]).stderr).toContain(`\`ticket ${sub}\` is not available to this agent`);
    }
    expect(tickets(db)).toEqual(before);
    // The instance-1 alias: a ticket assigned to `analista` is analista-1's.
    expect(ticketCommand(() => db, "analista-1", ["resolve", "4", "--response", "again"]).exitCode).toBe(0);
    // ANALISTA-2 in the row is analista-2.
    expect(ticketCommand(() => db, "analista-2", ["touch", "2"]).exitCode).toBe(0);
  });
});

/** Positions in the Other pile and a registry with two actives, one dormant, and another candidate's. */
function registryDb(path: string): Database {
  const db = openJobsDb(path);
  const run = (sql: string, ...p: Array<string | number | null>) => db.prepare(sql).run(...p);
  for (const [title, family, proposed] of [
    ["Data Eng", "Other", "Data Platform"], ["Data Eng 2", "Other", "data platform"], ["ML Ops", "Other", "MLOps"],
    ["Backend", "Backend", null], ["Backend 2", "Backend", null], ["Sales", null, null],
  ] as const) {
    run("INSERT INTO positions (title, company, url, status, role_family, role_family_proposed) VALUES (?, 'X', ?, 'checked', ?, ?)", title, `https://x.example/${title}`, family, proposed);
  }
  const f = "INSERT INTO role_family_registry (user_id, name, status, support_count, promoted_at) VALUES (?, ?, ?, ?, ?)";
  run(f, "local", "Backend", "active", 2, "2026-09-01 10:00:00");
  run(f, "local", "Zeta", "active", 2, null);
  run(f, "local", "Old", "dormant", 0, null);
  run(f, "cand-2", "Sales", "active", 9, null);
  return db;
}

const registry = (db: Database) => ({
  families: db.prepare("SELECT user_id, name, status, support_count, promoted_at IS NOT NULL AS promoted FROM role_family_registry ORDER BY user_id, name").all(),
  positions: db.prepare("SELECT id, role_family, role_family_proposed FROM positions ORDER BY id").all(),
});

const PROMOTES: string[][] = [
  ["promote", "--name", "Data Platform", "--ids", "1,2"],
  ["promote", "--name", "  Data Platform ", "--ids", "1, 2  3"],
  ["--dry-run", "promote", "--name", "MLOps", "--ids", "3"],
  ["promote", "--name", "Backend", "--ids", "6"],
  ["promote", "--name", "Old", "--ids", "3"],
  ["promote", "--name", "Other", "--ids", "1"],
  ["promote", "--name", "   ", "--ids", "1"],
  ["promote", "--name", "X", "--ids", " , "],
  ["promote", "--name", "X", "--ids", "1,two"],
  ["promote", "--name", "X", "--ids", "99"],
  ["promote", "--name", "It's", "--ids", "4"],
  ["--user-id", "local", "promote", "--name", "Y", "--ids", "5"],
  ["--user-id=local", "--dry-run", "promote", "--name", "Y", "--ids", "5"],
  ["promote", "--name", "X"],
  ["promote", "--name", "X", "--ids", "1", "--dry-run"],
  ["unknown"],
];

describe("role_registry promote against role_registry.py", () => {
  it.skipIf(skills === null).each(PROMOTES.map((p) => [p.join(" "), p]))("%s", (_label, args) => {
    const pyDb = registryDb(join(root, "py.db"));
    const ourDb = registryDb(join(root, "ours.db"));
    let ours;
    try {
      ours = roleRegistry(() => ourDb, "local", args as string[]);
    } catch (error) {
      ours = { stdout: "", stderr: `${(error as Error).message}\n`, exitCode: 2 };
    }
    const py = runPython(skills!, ["role_registry.py", ...(args as string[])], { JHT_DB: join(root, "py.db") });
    const last = (text: string | undefined) => (text ?? "").trim().split("\n").at(-1);
    expect([ours.exitCode, ours.stdout, last(ours.stderr)]).toEqual([py.status, py.stdout, last(py.stderr)]);
    expect(registry(ourDb)).toEqual(registry(pyDb));
  });

  it("promotes only in the local candidate's registry, and leaves merge and pass to others", () => {
    const db = registryDb(join(root, "x.db"));
    const before = registry(db);
    expect(roleRegistry(() => db, "local", ["--user-id", "cand-2", "promote", "--name", "Sales", "--ids", "6"]).stderr).toContain("local candidate's registry");
    for (const sub of ["merge", "pass"]) {
      expect(roleRegistry(() => db, "local", [sub, "--into", "X", "--sources", "Y"]).stderr).toContain(`\`role_registry ${sub}\` is not available to this agent`);
    }
    expect(registry(db)).toEqual(before);
  });
});

const SALARIES: string[][] = [
  ["--declared-min", "40000", "--declared-max", "55000"],
  ["--declared-min", "40000"],
  ["--position-id", "1"],
  ["--position-id", "2", "--declared-max", "90000"],
  ["--position-id", "3", "--stack", "python", "--seniority", "mid", "--country", "IT"],
  ["--position-id", "99"],
  ["--position-id", "0", "--stack", "python", "--seniority", "mid", "--country", "IT"],
  ["--stack", " Python ", "--seniority", "MID", "--country", "it"],
  ["--stack", "python", "--seniority", "mid", "--country", "IT", "--mode", "onsite"],
  ["--stack", "go", "--seniority", "senior", "--country", "DE"],
  ["--stack", "rust", "--seniority", "senior", "--country", "DE"],
  ["--stack", "java", "--seniority", "mid", "--country", "FR"],
  ["--stack", "python", "--seniority", "mid"],
  ["--stack", "", "--seniority", "mid", "--country", "IT"],
  ["--declared-min", "x"],
  ["--bogus"],
];

describe("salary_estimate against salary_estimate.py", () => {
  it.skipIf(skills === null).each(SALARIES.map((s) => [s.join(" "), s]))("%s", (_label, args) => {
    const home = join(root, "home");
    mkdirSync(join(home, ".cache"), { recursive: true });
    const now = Date.now() / 1000;
    const cacheFile = join(home, ".cache", "salary_estimates.json");
    writeFileSync(cacheFile, JSON.stringify({
      "python|mid|IT|remote": { min: 38000, max: 50000, currency: "EUR", source: "seed", fetched_at: "2026-09-18", fetched_at_ts: now - 86_400, ttl_days: 30 },
      "go|senior|DE|remote": { min: 70000, max: 90000, fetched_at_ts: now - 40 * 86_400 },
      "rust|senior|DE|remote": { min: 80000, max: 99000, currency: null, fetched_at_ts: now - 3600, ttl_days: 1 },
      "java|mid|FR|remote": { min: 45000, max: 60000, fetched_at_ts: "yesterday" },
    }));
    const db = openJobsDb(join(root, "s.db"));
    db.prepare("INSERT INTO positions (title, company, url, salary_declared_min, salary_declared_max) VALUES ('A', 'X', 'https://x.example/1', 45000, 60000)").run();
    db.prepare("INSERT INTO positions (title, company, url, salary_declared_min) VALUES ('B', 'X', 'https://x.example/2', 50000)").run();
    db.prepare("INSERT INTO positions (title, company, url) VALUES ('C', 'X', 'https://x.example/3')").run();
    let ours;
    try {
      ours = salaryEstimate(args as string[], { db: () => db, cacheFile });
    } catch (error) {
      ours = { stdout: "", stderr: `${(error as Error).message}\n`, exitCode: 2 };
    }
    const py = runPython(skills!, ["salary_estimate.py", ...(args as string[])], { JHT_HOME: home, JHT_DB: join(root, "s.db") });
    const last = (text: string | undefined) => (text ?? "").trim().split("\n").at(-1);
    expect([ours.exitCode, ours.stdout, last(ours.stderr)]).toEqual([py.status, py.stdout, last(py.stderr)]);
  });

  it("never writes the cache", () => {
    const db = openJobsDb(join(root, "s.db"));
    const r = salaryEstimate(["--seed-cache", "--stack", "x", "--seniority", "y", "--country", "IT", "--declared-min", "1", "--declared-max", "2"], { db: () => db, cacheFile: join(root, "c.json") });
    expect([r.exitCode, r.stderr]).toEqual([2, expect.stringContaining("not available to this agent")]);
  });
});

const POLICIES: Array<[string, string | null, string | null, string[]]> = [
  ["no files", null, null, ["show"]],
  ["full", '{"economy": false, "logo": {"enabled": false, "min_score": 70}, "geocode_missing": {"min_score": null, "non_remote_only": false}, "recheck_weekly": {"min_score": 65, "older_than_days": 21}}', '{"mode": " care "}', ["show"]],
  ["invalid values", '{"economy": "yes", "logo": {"min_score": 70.0}, "geocode_missing": {"min_score": 101}, "recheck_weekly": {"min_score": true, "older_than_days": 0}}', '{"mode": "harvest", "mode_until": "2026-01-01T10:00:00+02:00"}', ["show"]],
  ["not a dict", "[1, 2]", "[]", ["show"]],
  ["unknown mode", null, '{"mode": "maintenance", "mode_until": "not a date"}', ["show"]],
  ["unicode", '{"logo": {"enabled": true}, "note": "é"}', '{"mode": "saving", "mode_until": "2099-12-31 23:59"}', ["show"]],
  ["extra word", null, null, ["show", "x"]],
  ["no command", null, null, []],
  ["bad command", null, null, ["reset"]],
];

describe("enrichment_policy show against enrichment_policy.py", () => {
  it.skipIf(skills === null).each(POLICIES.map(([label, pol, mode, args]) => [label, pol, mode, args]))("%s", (_label, pol, mode, args) => {
    const profile = join(root, "profile");
    mkdirSync(profile, { recursive: true });
    if (pol !== null) writeFileSync(join(profile, "enrichment-policy.json"), pol as string);
    if (mode !== null) writeFileSync(join(profile, "capitano-maintenance.json"), mode as string);
    const ours = enrichmentPolicyCommand(new EnrichmentPolicy(profile), args as string[]);
    const py = runPython(skills!, ["enrichment_policy.py", ...(args as string[])], { JHT_DB: join(root, "jobs.db") });
    const last = (text: string | undefined) => (text ?? "").trim().split("\n").at(-1);
    expect([ours.exitCode, ours.stdout, last(ours.stderr)]).toEqual([py.status, py.stdout, last(py.stderr)]);
  });

  it("never sets the policy", () => {
    const r = enrichmentPolicyCommand(new EnrichmentPolicy(join(root, "profile")), ["set", "economy", "false"]);
    expect([r.exitCode, r.stderr]).toEqual([2, expect.stringContaining("`enrichment_policy set` is not available to this agent")]);
  });
});
