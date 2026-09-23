/**
 * T39, piece two: `apply_gate` and `application_answers` against the Python
 * they replace.
 *
 * The CLOSER reads its queue at every iteration (CL-04) and saves every answer
 * it works out (CL-08), so a line that differs is a decision that differs: a
 * position taken that the script would hold, a refusal read as an empty queue,
 * an inference written over the person's own answer. Hence byte for byte, and
 * hence SEQUENCES where there is state — a `save` followed by another `save`
 * on the same key proves what a single call cannot.
 *
 * Each side starts from its own clean folder and its own new database, never
 * from what the other left: the residue of one run is exactly what fakes an
 * agreement. The two sides use the SAME paths, rebuilt in between, because
 * paths are part of the output (the config in a refusal, the CV in the queue).
 *
 * The PDF layout check is the one seam. The script measures the CV with
 * poppler, which the image does not carry; without it every CV is
 * `cv_pdf_check_unavailable`, and the port says the same by default — the
 * cases under "a CV that cannot be measured" compare exactly that. To compare
 * what happens AFTER the check (checkpoints, emails, essentials, the cap),
 * both sides are given a check that passes: the port through its `cvLayout`
 * option, the script through a stub `pdf_layout_check` module.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { guarded, type ScriptResult } from "../src/db/tools.ts";
import { createSkillTools } from "../src/parity/skills/index.ts";
import { applicationAnswers, applyGate, type CloserOptions } from "../src/parity/skills/closer.ts";
import { pythonSkills, RUNTIME, runPython, SOURCE_COMMIT } from "./helpers/python-skills.ts";

const skills = pythonSkills();
const REPO = join(RUNTIME, "..", "..");
/**
 * Both scripts read the profile with PyYAML. Without it application_answers.py
 * answers every call with `ModuleNotFoundError` and apply_gate.py silently
 * skips the essentials hold: a comparison then measures the interpreter's
 * packages, not the port, so it skips as it does without python3.
 */
const pythonReady = skills !== null && runPython(skills, ["-c", "import yaml"]).status === 0;

/**
 * Where apply_gate.py looks for the rule: `Path(__file__).resolve().parents[1]
 * / "cloud"`. The extraction carries only `shared/skills`, so the rule is put
 * there from the same commit; the port is pointed at the same file, resolved
 * the way `resolve()` resolves it, so a refusal's `path` is one string.
 */
const RULE = skills === null ? "" : join(dirname(realpathSync(skills)), "cloud", "apply-request-rule.json");
const RULE_TEXT = skills === null ? "" : execFileSync("git", ["show", `${SOURCE_COMMIT}:shared/cloud/apply-request-rule.json`], { cwd: REPO, encoding: "utf8" });

let root: string;
let home: string;
let dbPath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-closer-tools-"));
  home = join(root, "jht");
  dbPath = join(root, "db", "jobs.db");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

type Seed = (db: Database) => void;

/** The same folder and a new database, empty but for what `seed` puts there. */
function fresh(seed: Seed): void {
  rmSync(home, { recursive: true, force: true });
  rmSync(dirname(dbPath), { recursive: true, force: true });
  mkdirSync(join(home, "profile"), { recursive: true });
  const db = openJobsDb(dbPath);
  try {
    seed(db);
  } finally {
    db.close();
  }
}

type Run = [stdout: string, stderr: string, exitCode: number];

/** A stub `pdf_layout_check` whose check passes, then the script as `__main__`. */
const LAYOUT_OK = [
  "import runpy, sys, types",
  "m = types.ModuleType('pdf_layout_check')",
  "class CheckError(Exception): pass",
  "m.CheckError = CheckError",
  "m.analyze = lambda pdf, **kw: {'ok': True}",
  "sys.modules['pdf_layout_check'] = m",
  "sys.argv = ['apply_gate.py'] + sys.argv[1:]",
  "runpy.run_path('apply_gate.py', run_name='__main__')",
].join("\n");

interface Side {
  runs: Run[];
  /** What the database holds afterwards, when the case asks for it. */
  after: unknown;
}

function ours(tool: typeof applyGate, sequence: string[][], seed: Seed, extra: Partial<CloserOptions>, snapshot?: (db: Database) => unknown): Side {
  fresh(seed);
  const db = openJobsDb(dbPath);
  try {
    // The CV folders the fixtures write to. The script confines nothing, so these
    // are the roots under which both sides must agree; the confinement itself
    // is held in parity-pdf-layout.test.ts (SICUREZZA T39-3: never the home).
    const options: CloserOptions = { db: () => db, jhtHome: home, profileDir: join(home, "profile"), rulePath: RULE, cvRoots: [join(home, "cv"), join(home, "abs")], ...extra };
    const runs = sequence.map((args): Run => {
      const r: ScriptResult = guarded(() => tool(args, options));
      return [r.stdout, r.stderr ?? "", r.exitCode];
    });
    return { runs, after: snapshot?.(db) };
  } finally {
    db.close();
  }
}

function theirs(script: string, sequence: string[][], seed: Seed, layoutOk: boolean, snapshot?: (db: Database) => unknown): Side {
  fresh(seed);
  // Not HOME: PyYAML may live in the user's site-packages, which HOME locates.
  const env = { JHT_HOME: home, JHT_DB: dbPath };
  const runs = sequence.map((args): Run => {
    const r = layoutOk ? runPython(skills!, ["-c", LAYOUT_OK, ...args], env) : runPython(skills!, [script, ...args], env);
    return [r.stdout, r.stderr, r.status];
  });
  if (!snapshot) return { runs, after: undefined };
  const db = openJobsDb(dbPath);
  try {
    return { runs, after: snapshot(db) };
  } finally {
    db.close();
  }
}

/** `apply_gate`, the same sequence on both sides. */
function compareGate(sequence: string[][], seed: Seed, layoutOk = false): Run[] {
  const a = ours(applyGate, sequence, seed, layoutOk ? { cvLayout: () => "" } : {});
  const b = theirs("apply_gate.py", sequence, seed, layoutOk);
  expect(a.runs).toEqual(b.runs);
  return a.runs;
}

/** An instant both sides write themselves (`_utc_now`, a DEFAULT): its FORMAT is compared, its value cannot be. */
const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const masked = (text: string) => text.replace(INSTANT, "<instant>");

const answersTable = (db: Database) =>
  (db.prepare("SELECT * FROM application_answers ORDER BY key").all() as Array<Record<string, unknown>>).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? masked(v) : v])),
  );

/** `application_answers`, the same sequence on both sides, and the table they leave. */
function compareAnswers(sequence: string[][], seed: Seed = () => {}): Run[] {
  const a = ours(applicationAnswers, sequence, seed, {}, answersTable);
  const b = theirs("application_answers.py", sequence, seed, false, answersTable);
  const shown = (side: Side) => side.runs.map(([out, err, code]): Run => [masked(out), err, code]);
  expect(shown(a)).toEqual(shown(b));
  expect(a.after).toEqual(b.after);
  return a.runs;
}

// ── seeds ────────────────────────────────────────────────────────────────

const writeConfig = (config: unknown) => writeFileSync(join(home, "jht.config.json"), typeof config === "string" ? config : JSON.stringify(config));
const consent = (auto: Record<string, unknown> = {}) => writeConfig({ applications: { auto_apply: { enabled: true, ...auto } } });

interface PositionSeed {
  id: number;
  status?: string;
  url?: string | null;
  flag?: number;
  at?: string | null;
  by?: string | null;
  company?: string;
}

function position(db: Database, p: PositionSeed): void {
  db.prepare(
    "INSERT INTO positions (id, title, company, url, status, found_by, apply_requested, apply_requested_at, apply_requested_by) VALUES (?, 'Backend Engineer', ?, ?, ?, 'scout-1', ?, ?, ?)",
  ).run(
    p.id,
    p.company ?? `Acme ${p.id}`,
    p.url === undefined ? `https://jobs.example/${p.id}` : p.url,
    p.status ?? "ready",
    p.flag ?? 1,
    p.at === undefined ? "2026-09-20 10:00:00" : p.at,
    p.by === undefined ? "user_web" : p.by,
  );
}

/**
 * A send of TODAY, in the shape the cap's own SQL compares it against.
 *
 * The cap counts `date(applied_at) = date('now', 'localtime')`: the column is
 * read as it is stored and the day is the LOCAL one. A seed written with
 * `new Date().toISOString()` is UTC, so between local midnight and the UTC one
 * the two dates are different days and the row is not counted — which is why
 * CL-06 was red only at night (found by FULLSTACK-3, reproduced on master at
 * 00:21 CEST, 24/09). Both sides read the same literal, and the date comes from
 * the database itself, so the seed says the same thing at any hour and in any
 * zone. That the product's SQL compares two shapes of time at all is a defect
 * of its own, measured and pinned below.
 */
const localToday = (db: Database): string => (db.prepare("SELECT date('now', 'localtime') AS d").get() as { d: string }).d;

/** An application row with a CV on disk. `cv` relative is relative to the JHT home, as the script reads it. */
function application(db: Database, positionId: number, cv: string | null = `cv/CV-${positionId}.pdf`, applied = 0, via: string | null = null): void {
  if (cv !== null) {
    const full = cv.startsWith("/") ? cv : join(home, cv);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "not a pdf, only a file the check will not measure");
  }
  db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path, applied, applied_via, applied_at) VALUES (?, 'ready', 'scrittore-1', ?, ?, ?, ?)").run(
    positionId,
    cv,
    applied,
    via,
    applied ? `${localToday(db)} 10:00:00` : null,
  );
}

function checkpoint(positionId: number, data: unknown, dir = "apply-flow"): void {
  mkdirSync(join(home, ".cache", dir), { recursive: true });
  writeFileSync(join(home, ".cache", dir, `${positionId}.json`), typeof data === "string" ? data : JSON.stringify(data));
}

const profile = (yaml: string) => writeFileSync(join(home, "profile", "candidate_profile.yml"), yaml);

/** A question row of the CLOSER's, as jht-notify-user leaves it. */
function question(db: Database, sourceId: string, payload: unknown, hoursAgo: number, reply: string | null = null): void {
  db.prepare(
    "INSERT INTO pending_user_messages (agent, body, kind, source_id, source_action, source_payload, related_position_id, user_reply, created_at) " +
      "VALUES ('closer', 'Question: …', 'question', ?, 'closer_application_answer', ?, NULL, ?, datetime('now', ?))",
  ).run(sourceId, typeof payload === "string" ? payload : JSON.stringify(payload), reply, `-${hoursAgo} hours`);
}

const essential = (key: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  position_id: 1,
  key,
  label: `the ${key}`,
  field_type: key === "sponsorship" || key === "relocation" ? "radio" : "text",
  options: key === "sponsorship" || key === "relocation" ? ["Yes", "No"] : [],
  explicit: true,
  ...extra,
});

// ── apply_gate ───────────────────────────────────────────────────────────

describe.skipIf(skills === null || !pythonReady)("apply_gate against apply_gate.py", () => {
  beforeAll(() => {
    mkdirSync(dirname(RULE), { recursive: true });
    writeFileSync(RULE, RULE_TEXT);
  });
  afterAll(() => {
    rmSync(RULE, { force: true });
  });

  const ALL = [["consent"], ["consent", "--json"], ["position", "1"], ["position", "1", "--json"], ["queue"], ["queue", "--json"]];

  it("no config at all: every check is closed, with the path it looked at", () => {
    const runs = compareGate(ALL, (db) => position(db, { id: 1 }));
    expect(runs.every(([, , code]) => code === 1)).toBe(true);
    expect(runs[1]![0]).toContain('"reason": "config_missing"');
  });

  it("a config it cannot read as consent is closed, each for its own reason", () => {
    const configs: unknown[] = [
      "{ not json",
      "[1, 2]",
      "",
      {},
      { applications: [] },
      { applications: { auto_apply: "yes" } },
      { applications: { auto_apply: {} } },
      { applications: { auto_apply: { enabled: "true" } } },
      { applications: { auto_apply: { enabled: 1 } } },
      { applications: { auto_apply: { enabled: false } } },
      { applications: { auto_apply: { enabled: null } } },
      { applications: { auto_apply: { enabled: true, mode: "live" } } },
      { applications: { auto_apply: { enabled: true, mode: null } } },
      { applications: { auto_apply: { enabled: true, mode: ["authorised"] } } },
      { applications: { auto_apply: { enabled: true, max_per_day: 0 } } },
      { applications: { auto_apply: { enabled: true, max_per_day: -3 } } },
      { applications: { auto_apply: { enabled: true, max_per_day: "3" } } },
      { applications: { auto_apply: { enabled: true, max_per_day: true } } },
      { applications: { auto_apply: { enabled: [true, { "l'utente": "è" }] } } },
    ];
    for (const config of configs) compareGate([["consent"], ["consent", "--json"], ["position", "7", "--json"]], () => writeConfig(config));
  });

  it("a float is not an int: `max_per_day: 2.0` is refused on both sides, and `2` is a cap", () => {
    const runs = compareGate([["consent", "--json"]], () => writeConfig('{"applications": {"auto_apply": {"enabled": true, "max_per_day": 2.0}}}'));
    expect(runs[0]![0]).toContain('"max_per_day": "2.0"');
    compareGate([["consent", "--json"], ["consent"]], () => writeConfig('{"applications": {"auto_apply": {"enabled": true, "max_per_day": 2, "mode": "dry_run"}}}'));
    compareGate([["consent", "--json"], ["consent"]], () => writeConfig('{"applications": {"auto_apply": {"enabled": true, "max_per_day": null}}}'));
  });

  it("the verdict on one position, in every way it can say no and the one it says yes", () => {
    const seed: Seed = (db) => {
      consent({ max_per_day: 3 });
      position(db, { id: 1 });
      position(db, { id: 2, by: "agent_closer" });
      position(db, { id: 3, flag: 0 });
      position(db, { id: 4, at: null });
      position(db, { id: 5, at: "" });
      position(db, { id: 6, status: "applied" });
      position(db, { id: 7, status: "response" });
      position(db, { id: 8 });
      application(db, 8, null, 1, "agent_closer");
      position(db, { id: 9, by: null });
      position(db, { id: 10, status: "scored", by: "user_local" });
      position(db, { id: 11, by: "user_telegram", at: "2026-09-20T10:00:00.000Z" });
    };
    const ids = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "99", "0", "-4"];
    const runs = compareGate(
      ids.flatMap((id) => [
        ["position", id, "--json"],
        ["position", id],
      ]),
      seed,
    );
    expect(runs[0]).toEqual([expect.stringContaining('"reason": "apply_allowed"'), "", 0]);
  });

  it("the queue: a CV that cannot be measured holds its position, and the queue is empty — not unreadable", () => {
    const seed: Seed = (db) => {
      consent();
      position(db, { id: 1 });
      application(db, 1);
      position(db, { id: 2, url: "   " });
      application(db, 2);
      position(db, { id: 3 });
      application(db, 3, "cv/missing.pdf");
      rmSync(join(home, "cv", "missing.pdf"));
      position(db, { id: 4 });
      position(db, { id: 5, by: "agent_closer" });
      position(db, { id: 6, status: "scored" });
      position(db, { id: 7, at: "2026-09-19 09:00:00" });
      application(db, 7, join(home, "abs", "CV.pdf"));
    };
    const runs = compareGate([["queue", "--json"], ["queue"]], seed);
    expect(runs[0]![0]).toContain('"reason": "queue_empty"');
    expect(runs[0]![0]).toContain('"cv_pdf_check_unavailable"');
  });

  it("the queue past the CV check: checkpoints, emails, essentials and the order they hold in", () => {
    const seed: Seed = (db) => {
      consent();
      profile("name: Test\ncontacts:\n  phone: '+39 000'\n");
      // 1: nothing holds it.
      position(db, { id: 1, at: "2026-09-20 10:00:00" });
      application(db, 1);
      // 2: blocked_human AFTER the authorisation: held. 3: the person authorised again after it: released.
      position(db, { id: 2, at: "2026-09-20 10:00:00" });
      application(db, 2);
      checkpoint(2, { state: "blocked_human", updated_at: "2026-09-20T12:00:00Z" });
      position(db, { id: 3, at: "2026-09-20 13:00:00" });
      application(db, 3);
      checkpoint(3, { state: "blocked_human", updated_at: "2026-09-20T12:00:00+00:00" });
      // 4: retry later, in the future. 5: in the past. 6: a checkpoint that is not JSON.
      position(db, { id: 4 });
      application(db, 4);
      checkpoint(4, { state: "retry_later", retry_after: "2999-01-01T00:00:00Z" });
      position(db, { id: 5 });
      application(db, 5);
      checkpoint(5, { state: "retry_later", retry_after: "2001-01-01T00:00:00Z" });
      position(db, { id: 6 });
      application(db, 6);
      checkpoint(6, "{ half");
      // 7: a question the flow stopped on that nobody asked. 8: the stop was the CV's layout.
      position(db, { id: 7 });
      application(db, 7);
      checkpoint(7, { state: "blocked_human", updated_at: "2026-09-21T00:00:00Z", answer_request: { asked: false, message_id: "  " } });
      position(db, { id: 8 });
      application(db, 8);
      checkpoint(8, { state: "dry_run", updated_at: "2026-09-21T00:00:00Z", blocked_reason: "cv_pdf_check_unavailable" });
      // 9: an email whose outcome nobody knows. 10: the email flow's own human stop.
      position(db, { id: 9 });
      application(db, 9);
      db.prepare(
        "INSERT INTO email_application_attempts (position_id, idempotency_key, state, message_id, recipients_json, body_sha256, attachments_json, send_started_at) VALUES (9, 'k', 'send_started', 'm', '[]', 'h', '[]', '2026-09-20T10:00:00Z')",
      ).run();
      position(db, { id: 10 });
      application(db, 10);
      checkpoint(10, { state: "denied", updated_at: "2026-09-21T00:00:00Z" }, "email-application");
      // 11: an unknown checkpoint state does not hold. 12: an email stop caused by the CV's layout does not either.
      position(db, { id: 11 });
      application(db, 11);
      checkpoint(11, { state: "something_new" });
      position(db, { id: 12 });
      application(db, 12);
      checkpoint(12, { state: "blocked_human", reason: "cv_pdf_layout_bad", updated_at: "2026-09-21T00:00:00Z" }, "email-application");
    };
    const runs = compareGate([["queue", "--json"], ["queue"]], seed, true);
    expect(runs[0]![0]).toContain('"reason": "queue_ready"');
    expect(runs[0]![2]).toBe(0);
  });

  it("an essential question asked and unanswered holds every position; a day later it does not", () => {
    for (const hoursAgo of [1, 30]) {
      const seed: Seed = (db) => {
        consent();
        profile("name: Test\n");
        position(db, { id: 1 });
        application(db, 1);
        question(db, "closer-essential:phone", essential("phone"), hoursAgo);
      };
      compareGate([["queue", "--json"]], seed, true);
    }
  });

  it("a broken profile never breaks the queue: it warns on stderr and the queue goes on", () => {
    const seed: Seed = (db) => {
      consent();
      mkdirSync(join(home, "profile", "candidate_profile.yml"), { recursive: true });
      position(db, { id: 1 });
      application(db, 1);
    };
    const runs = compareGate([["queue", "--json"], ["queue"]], seed, true);
    expect(runs[0]![1]).toBe("[apply-gate] profile unreadable for the essentials hold: IsADirectoryError\n");
  });

  it("the daily cap, when the person set one, is a wall (CL-06)", () => {
    const seed: Seed = (db) => {
      consent({ max_per_day: 1 });
      position(db, { id: 1, status: "applied" });
      application(db, 1, null, 1, "agent_closer");
      position(db, { id: 2 });
      application(db, 2);
    };
    const runs = compareGate([["queue", "--json"], ["queue"]], seed, true);
    expect(runs[0]![0]).toContain('"reason": "daily_cap_reached"');
    // A send by the person does not use the automation's quota.
    compareGate(
      [["queue", "--json"]],
      (db) => {
        consent({ max_per_day: 1 });
        position(db, { id: 1, status: "applied" });
        application(db, 1, null, 1, "user_manual");
        position(db, { id: 2 });
        application(db, 2);
      },
      true,
    );
  });

  it("a rule it cannot read closes every position, and the queue says unreadable — not empty", () => {
    rmSync(RULE, { force: true });
    try {
      const runs = compareGate([["position", "1", "--json"], ["position", "1"], ["queue", "--json"], ["queue"]], (db) => {
        consent();
        position(db, { id: 1 });
        application(db, 1);
      });
      expect(runs[0]![0]).toContain('"reason": "rule_unavailable"');
      expect(runs[2]![0]).toContain('"reason": "queue_unreadable"');
    } finally {
      writeFileSync(RULE, RULE_TEXT);
    }
  });

  it("an argument argparse would refuse is exit 2, with argparse's error line", () => {
    const a = ours(applyGate, [[], ["bogus"], ["position"], ["position", "abc"], ["queue", "1", "2"]], () => {}, {});
    const b = theirs("apply_gate.py", [[], ["bogus"], ["position"], ["position", "abc"], ["queue", "1", "2"]], () => {}, false);
    // The usage line is shorter here (argv.ts): the error line and the code are the contract.
    const last = (runs: Run[]) => runs.map(([out, err, code]) => [out, err.trim().split("\n").at(-1), code]);
    expect(last(a.runs)).toEqual(last(b.runs));
  });
});

// ── application_answers ──────────────────────────────────────────────────

describe.skipIf(skills === null || !pythonReady)("application_answers against application_answers.py", () => {
  it("essentials: nothing known, then what the profile says — a YAML date is not a known fact, as for PyYAML", () => {
    compareAnswers([["essentials", "--position-id", "1", "--json"], ["essentials", "--position-id", "1"]]);
    const seed: Seed = () =>
      profile(
        [
          "name: Test",
          "availability: 2026-10-01",
          "notice_period: '  '",
          "sponsorship: no",
          "willing_to_relocate: yes",
          "salary_expectation: 55000",
          "contacts:",
          "  phone: '+39 000 0000'",
          "application_answers:",
          "  - question: Work Authorization",
          "    answer: EU",
        ].join("\n"),
      );
    compareAnswers([["essentials", "--position-id", "1", "--json"]], seed);
    compareAnswers([["essentials", "--position-id", "1", "--json"]], () => profile("application_answers:\n  'Notice  period!': 1 month\n  availability: ''\n"));
  });

  it("essentials: asked and waiting, expired after a day, given up after the second — and a reply on the row counts", () => {
    const seed: Seed = (db) => {
      question(db, "closer-essential:phone", essential("phone"), 2);
      question(db, "closer-essential:availability", essential("availability"), 30);
      question(db, "closer-essential:notice_period", essential("notice period"), 60);
      question(db, "closer-essential:notice_period:2", essential("notice period"), 30);
      question(db, "closer-essential:sponsorship", essential("sponsorship"), 2, "No");
      question(db, "closer-essential:relocation", essential("relocation"), 2, "Maybe");
      // Asked, but not by the CLOSER's explicit ask: it does not hold.
      question(db, "closer-essential:work_authorization", essential("work authorization", { explicit: false, field_type: "textarea" }), 2);
    };
    const runs = compareAnswers([["essentials", "--position-id", "1", "--json"]], seed);
    expect(runs[0]![2]).toBe(3);
  });

  it("save: every shape a field can have, and the scope each answer is kept under", () => {
    const seed: Seed = (db) => {
      position(db, { id: 1, company: "Acme S.p.A." });
      position(db, { id: 2, company: "Straße & Söhne" });
      checkpoint(2, { state: "blocked_human", answer_request: { payload: { key: "Your Message", purpose: "contact_form_application" } } });
    };
    compareAnswers(
      [
        ["save", "--key", "Earliest start date?", "--value", "  1 November 2026 ", "--field-type", "text", "--basis", "profile", "--json"],
        ["save", "--key", "Sponsorship", "--value", "No", "--field-type", "radio", "--options", "Yes", "No", "--basis", "cv"],
        ["save", "--key", "Relocation", "--value", "Perhaps", "--field-type", "radio", "--options", "Yes", "No", "--basis", "judgement"],
        ["save", "--key", "Remote OK", "--value", "Yes", "--field-type", "checkbox", "--basis", "vacancy"],
        ["save", "--key", "Languages", "--value", "  Italian \r\n\n English\n", "--field-type", "checkboxes", "--options", "Italian", "English", "French", "--basis", "cv"],
        ["save", "--key", "Tools", "--value", '["Git", "Git"]', "--field-type", "checkboxes", "--options", "Git", "Docker", "--basis", "cv"],
        ["save", "--key", "Why us?", "--value", "Because.", "--field-type", "textarea", "--basis", "judgement"],
        ["save", "--key", "Why us?", "--value", "Because of the product.", "--field-type", "textarea", "--basis", "judgement", "--position-id", "1"],
        ["save", "--key", "Salary expectations", "--value", "60k EUR", "--field-type", "text", "--basis", "judgement", "--position-id", "2"],
        ["save", "--key", "Your Message", "--value", "Dear team…", "--field-type", "textarea", "--basis", "cv", "--position-id", "2"],
        ["save", "--key", "Cover", "--value", "Hello", "--field-type", "textarea", "--basis", "cv", "--position-id", "1", "--purpose", "contact_form_application"],
        ["save", "--key", "Phone", "--value", "+39 000", "--field-type", "tel", "--basis", "profile", "--label", "Your phone"],
        ["save", "--key", "!!!", "--value", "x", "--field-type", "text", "--basis", "cv"],
        ["save", "--key", "Blank", "--value", "   ", "--field-type", "text", "--basis", "cv"],
        ["save", "--key", "Odd", "--value", "x", "--field-type", "slider", "--basis", "cv"],
        ["save", "--key", "Pick", "--value", "A", "--field-type", "select", "--options", "A", "A", "--basis", "cv"],
        ["save", "--key", "Text with options", "--value", "A", "--field-type", "text", "--options", "A", "--basis", "cv"],
        ["list", "--json"],
      ],
      seed,
    );
  });

  it("save over the person's own answer keeps theirs (user_answer_kept), and over its own inference replaces it", () => {
    const seed: Seed = (db) => {
      db.prepare(
        "INSERT INTO application_answers (key, label, answer_json, field_type, options_json, channel, answered_at) VALUES ('notice period', 'Notice', '\"3 months\"', 'text', '[]', 'telegram', '2026-09-01T00:00:00.000Z')",
      ).run();
    };
    const runs = compareAnswers(
      [
        ["save", "--key", "Notice period", "--value", "1 month", "--field-type", "text", "--basis", "judgement"],
        ["save", "--key", "Availability", "--value", "now", "--field-type", "text", "--basis", "judgement"],
        ["save", "--key", "availability", "--value", "in two weeks", "--field-type", "text", "--basis", "cv"],
        ["list"],
        ["essentials", "--position-id", "1", "--json"],
      ],
      seed,
    );
    expect(runs[0]).toEqual([expect.stringContaining('"status": "user_answer_kept"'), "", 3]);
  });

  it("an argument argparse would refuse is exit 2 — a basis outside the four included — and nothing is written", () => {
    const sequence = [
      [],
      ["save", "--key", "k", "--value", "v", "--field-type", "text", "--basis", "intuition"],
      ["save", "--key", "k", "--value", "v", "--field-type", "text"],
      ["essentials"],
      ["essentials", "--position-id", "x"],
    ];
    const a = ours(applicationAnswers, sequence, () => {}, {}, answersTable);
    const b = theirs("application_answers.py", sequence, () => {}, false, answersTable);
    const last = (runs: Run[]) => runs.map(([out, err, code]) => [out, err.trim().split("\n").at(-1), code]);
    expect(last(a.runs)).toEqual(last(b.runs));
    expect(a.after).toEqual([]);
    expect(b.after).toEqual([]);
  });
});

// ── what the port may not do ─────────────────────────────────────────────

describe("what the CLOSER's tools refuse, and what they never write", () => {
  let db: Database;
  let options: CloserOptions;
  beforeEach(() => {
    mkdirSync(join(home, "profile"), { recursive: true });
    db = openJobsDb(dbPath);
    options = { db: () => db, jhtHome: home, profileDir: join(home, "profile"), cvRoots: [join(home, "cv")] };
  });
  afterEach(() => db.close());

  it("`ask`, `essentials --ask` and `wake-idle-closer` are refused with the reason, and nothing is sent or written", () => {
    const before = db.prepare("SELECT count(*) AS n FROM pending_user_messages").get();
    for (const args of [
      ["ask", "--position-id", "1", "--key", "notice period"],
      ["essentials", "--position-id", "1", "--ask", "phone"],
      ["essentials", "--position-id", "1", "--ask=phone"],
      ["wake-idle-closer"],
    ]) {
      const r = guarded(() => applicationAnswers(args, options));
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Nothing was sent");
    }
    expect(guarded(() => applicationAnswers(["ask", "--key", "k"], options)).stderr).toContain("notify_user");
    expect(db.prepare("SELECT count(*) AS n FROM pending_user_messages").get()).toEqual(before);
    expect(db.prepare("SELECT count(*) AS n FROM application_answers").get()).toEqual({ n: 0 });
  });

  it("takes no path from the model: --db, --config and --profile are refused, not ignored", () => {
    for (const args of [["queue", "--db", "/tmp/other.db"], ["consent", "--config=/tmp/c.json"], ["queue", "--conf", "x"], ["position", "1", "--d", "x"]]) {
      const r = guarded(() => applyGate(args, options));
      expect([r.exitCode, r.stderr]).toEqual([2, expect.stringContaining("is not taken here")]);
    }
    for (const args of [["list", "--db", "x"], ["essentials", "--position-id", "1", "--profile", "/etc/passwd"], ["list", "--pro", "x"]]) {
      const r = guarded(() => applicationAnswers(args, options));
      expect([r.exitCode, r.stderr]).toEqual([2, expect.stringContaining("is not taken here")]);
    }
  });

  it("no read and no save ever writes the sent state (CL-02)", () => {
    writeFileSync(join(home, "jht.config.json"), JSON.stringify({ applications: { auto_apply: { enabled: true } } }));
    db.prepare("INSERT INTO positions (id, title, company, url, status, found_by, apply_requested, apply_requested_at, apply_requested_by) VALUES (1, 'T', 'Acme', 'https://x.example/1', 'ready', 'scout-1', 1, '2026-09-20 10:00:00', 'user_web')").run();
    mkdirSync(join(home, "cv"), { recursive: true });
    writeFileSync(join(home, "cv", "CV.pdf"), "x");
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'ready', 'scrittore-1', 'cv/CV.pdf')").run();
    const state = () => ({
      position: db.prepare("SELECT status, apply_requested, apply_requested_at, apply_requested_by FROM positions WHERE id = 1").get(),
      application: db.prepare("SELECT status, applied, applied_at, applied_via FROM applications WHERE position_id = 1").get(),
      reservations: db.prepare("SELECT count(*) AS n FROM apply_cap_reservations").get(),
    });
    const before = state();
    // Even with a check that passes, so the queue is ready and the position is offered.
    const ready = guarded(() => applyGate(["queue", "--json"], { ...options, cvLayout: () => "" }));
    expect([ready.exitCode, JSON.parse(ready.stdout).positions]).toEqual([0, [{ position_id: 1, url: "https://x.example/1", cv_pdf_path: join(home, "cv", "CV.pdf") }]]);
    guarded(() => applyGate(["position", "1", "--json"], options));
    guarded(() => applicationAnswers(["save", "--key", "k", "--value", "v", "--field-type", "text", "--basis", "cv", "--position-id", "1"], options));
    expect(state()).toEqual(before);
    // The default check is the image's: no poppler, so the CV is never waved through unmeasured.
    const held = guarded(() => applyGate(["queue", "--json"], options));
    expect([held.exitCode, JSON.parse(held.stdout).held]).toEqual([1, [{ position_id: 1, reason: "cv_pdf_check_unavailable" }]]);
  });

  it("uses the rule shipped beside it when none is given, and closes when that file is gone", () => {
    writeFileSync(join(home, "jht.config.json"), JSON.stringify({ applications: { auto_apply: { enabled: true } } }));
    db.prepare("INSERT INTO positions (id, title, company, url, status, found_by, apply_requested, apply_requested_at, apply_requested_by) VALUES (1, 'T', 'Acme', 'https://x.example/1', 'ready', 'scout-1', 1, '2026-09-20 10:00:00', 'user_web')").run();
    expect(JSON.parse(guarded(() => applyGate(["position", "1", "--json"], options)).stdout).reason).toBe("apply_allowed");
    const gone = guarded(() => applyGate(["position", "1", "--json"], { ...options, rulePath: join(root, "nowhere.json") }));
    expect(JSON.parse(gone.stdout)).toMatchObject({ allowed: false, reason: "rule_unavailable" });
    expect(gone.exitCode).toBe(1);
  });
});

describe("which role gets the CLOSER's tools", () => {
  it("the CLOSER, from the skills it lists; the CAPITANO only the gate, to read; nobody else", () => {
    const db = { open: () => openJobsDb(":memory:"), path: ":memory:" };
    const list = (role: string) =>
      readFileSync(join(REPO, "agents", role, "skills.list"), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
    const closer = createSkillTools({ skills: list("closer"), agent: "closer-1", jobsDb: db, jhtHome: join(root, "jht") }).map((t) => t.spec.name);
    expect(closer).toContain("apply_gate");
    expect(closer).toContain("application_answers");
    // No database, no queue: the tools are not offered rather than offered broken.
    expect(createSkillTools({ skills: list("closer"), agent: "closer-1", jhtHome: join(root, "jht") }).map((t) => t.spec.name)).not.toContain("apply_gate");
    // capitano.md runs `apply_gate.py queue` to decide whether a CLOSER is worth
    // spawning: it reads the gate, and nothing else of the CLOSER's.
    const captain = createSkillTools({ skills: list("capitano"), agent: "capitano", jobsDb: db, jhtHome: join(root, "jht") }).map((t) => t.spec.name);
    expect(captain).toContain("apply_gate");
    expect(captain).not.toContain("application_answers");
    for (const role of ["scrittore", "sentinella", "assistente"]) {
      const names = createSkillTools({ skills: list(role), agent: `${role}-1`, jobsDb: db, jhtHome: join(root, "jht") }).map((t) => t.spec.name);
      expect(names).not.toContain("apply_gate");
      expect(names).not.toContain("application_answers");
    }
  });
});

/**
 * The rule is a copy: the image carries no `shared/`. A copy is how a rule
 * splits in silence — here it would mean the dashboard's button authorising
 * what the gate refuses — so the two are held together wherever the original
 * is at hand.
 */
describe("the rule shipped with the runtime against shared/cloud/apply-request-rule.json", () => {
  const original = join(REPO, "shared", "cloud", "apply-request-rule.json");
  it.skipIf(!existsSync(original))("is the same file, byte for byte", () => {
    expect(readFileSync(join(RUNTIME, "src", "parity", "skills", "apply-request-rule.json"), "utf8")).toBe(readFileSync(original, "utf8"));
  });
});
