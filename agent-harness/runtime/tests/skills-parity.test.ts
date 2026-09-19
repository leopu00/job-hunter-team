/**
 * T7: the Scout's Python skills as native tools, checked against the scripts
 * themselves.
 *
 * Each case runs `shared/skills/<skill>.py` and the native tool on the same
 * input — two copies of the same jobs.db, one per side — and compares what
 * each prints, then what each left in the database. Timestamps and database
 * paths are the only things normalised: they differ by construction.
 *
 * Needs python3; without it the parity cases are skipped and the native-only
 * cases still run. Nothing leaves the machine, nothing is spent.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { createEmailMonitorTool, IMAP_UNAVAILABLE_NOTE } from "../src/parity/skills/email-monitor.ts";
import { sanitizeFeedbackDisplay } from "../src/parity/skills/feedback-display.ts";
import { createFeedbackQueryTool } from "../src/parity/skills/feedback-query.ts";
import { createScoutCoordTool } from "../src/parity/skills/scout-coord.ts";
import type { ToolHandler } from "../src/tools/registry.ts";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "shared", "skills");
const HAS_PYTHON = spawnSync("python3", ["--version"]).status === 0;
const CONTEXT = { account: undefined as never, remainingMs: () => 60_000 };

let root: string;
let jhtHome: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-api-skills-"));
  jhtHome = join(root, "jht_home");
  mkdirSync(jhtHome);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The script, run as the TUI runs it: `python3 <skill> <args>` with JHT_DB and JHT_HOME set. */
function python(skill: string, args: string[], env: Record<string, string>) {
  const run = spawnSync("python3", [join(SKILLS, skill), ...args], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1", JHT_HOME: jhtHome, ...env },
  });
  const stdout = run.stdout.replace(/\n$/, "");
  return { status: run.status, stdout: stdout === "" ? "(no output)" : stdout, stderr: run.stderr.trim() };
}

async function native(tool: ToolHandler, args: Record<string, unknown>) {
  return tool.execute(tool.spec.schema.parse(args), CONTEXT);
}

/** Timestamps and database paths differ by construction; everything else must not. */
function norm(text: string, ...paths: string[]): string {
  let out = text;
  for (const p of paths) out = out.split(p).join("<DB>");
  return out.replace(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?/g, "<TS>");
}

function dump(db: Database, table: string): unknown[] {
  return (db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? norm(v) : v])),
  );
}

describe.skipIf(!HAS_PYTHON)("scout_coord ↔ scout_coord.py", () => {
  it("prints the same lines and leaves the same tables, command by command", async () => {
    const pyDb = join(root, "py", "jobs.db");
    const tsDb = join(root, "ts", "jobs.db");
    openJobsDb(pyDb).close();
    const db = openJobsDb(tsDb);
    // One tool per Scout, as each agent gets its own (D-2).
    const tools = new Map<string, ToolHandler>();
    const as = (agent: string) => {
      if (!tools.has(agent)) tools.set(agent, createScoutCoordTool({ agent, db: () => db, dbPath: tsDb }));
      return tools.get(agent)!;
    };

    // [agent running the tool, script args, tool args]
    const steps: Array<[string, string[], Record<string, unknown>]> = [
      ["scout-1", ["show"], { command: "show" }],
      ["scout-1", ["history"], { command: "history" }],
      ["scout-1", ["check-claim", "https://jobs.example/1"], { command: "check-claim", job_id: "https://jobs.example/1" }],
      ["scout-1", ["claim", "https://jobs.example/1", "scout-1"], { command: "claim", job_id: "https://jobs.example/1", scout: "scout-1" }],
      ["scout-2", ["claim", "https://jobs.example/1", "scout-2"], { command: "claim", job_id: "https://jobs.example/1" }],
      ["scout-2", ["check-claim", "https://jobs.example/1"], { command: "check-claim", job_id: "https://jobs.example/1" }],
      ["scout-1", ["reset"], { command: "reset" }],
      ["scout-1", ["assign", "scout-1", "--cerchi", "1,2", "--fonti", "linkedin,greenhouse"], { command: "assign", scout: "scout-1", cerchi: "1,2", fonti: "linkedin,greenhouse" }],
      ["scout-1", ["assign", "scout-1", "--cerchi", "1", "--fonti", "remoteok"], { command: "assign", cerchi: "1", fonti: "remoteok" }],
      ["scout-2", ["assign", "scout-2", "--fonti", "lever", "--note", "curated only"], { command: "assign", fonti: "lever", note: "curated only" }],
      // An empty value prints as "-", like a missing one.
      ["scout-4", ["assign", "scout-4", "--cerchi", "", "--fonti", "x"], { command: "assign", scout: "scout-4", cerchi: "", fonti: "x" }],
      ["scout-2", ["show"], { command: "show" }],
      ["scout-2", ["history"], { command: "history" }],
    ];
    for (const [agent, pyArgs, tsArgs] of steps) {
      const py = python("scout_coord.py", pyArgs, { JHT_DB: pyDb });
      const ts = await native(as(agent), tsArgs);
      expect(py.status, pyArgs.join(" ")).toBe(0);
      expect(norm(ts.content), pyArgs.join(" ")).toBe(norm(py.stdout));
      expect(ts.ok).toBe(true);
    }

    const pyView = openJobsDb(pyDb);
    for (const table of ["scout_coordination", "scout_claims"]) expect(dump(db, table), table).toEqual(dump(pyView, table));
    pyView.close();
    db.close();
  });

  it("resets as the script does when the split is the caller's alone", async () => {
    const pyDb = join(root, "py", "jobs.db");
    const tsDb = join(root, "ts", "jobs.db");
    openJobsDb(pyDb).close();
    const db = openJobsDb(tsDb);
    const tool = createScoutCoordTool({ agent: "scout-1", db: () => db, dbPath: tsDb });
    for (const [pyArgs, tsArgs] of [
      [["assign", "scout-1", "--cerchi", "1"], { command: "assign", cerchi: "1" }],
      [["reset"], { command: "reset" }],
      [["show"], { command: "show" }],
      [["history"], { command: "history" }],
    ] as const) {
      const py = python("scout_coord.py", [...pyArgs], { JHT_DB: pyDb });
      expect(norm((await native(tool, tsArgs)).content), pyArgs.join(" ")).toBe(norm(py.stdout));
    }
    const pyView = openJobsDb(pyDb);
    expect(dump(db, "scout_coordination")).toEqual(dump(pyView, "scout_coordination"));
    pyView.close();
    db.close();
  });

  it("refuses a name that is not a Scout's with the script's message and writes nothing", async () => {
    const pyDb = join(root, "py", "jobs.db");
    openJobsDb(pyDb).close();
    const db = openJobsDb(":memory:");
    const tool = createScoutCoordTool({ agent: "scout-1", db: () => db, dbPath: ":memory:" });
    const py = python("scout_coord.py", ["assign", "--help"], { JHT_DB: pyDb });
    const ts = await native(tool, { command: "assign", scout: "--help" });
    expect(py.status).toBe(3);
    expect(ts.ok).toBe(false);
    expect(ts.content).toBe(py.stderr);
    expect(dump(db, "scout_coordination")).toEqual([]);
  });

  it("doctor reports the same facts, as text and as JSON", async () => {
    const pyDb = join(root, "py", "jobs.db");
    const tsDb = join(root, "ts", "jobs.db");
    openJobsDb(pyDb).close();
    const db = openJobsDb(tsDb);
    const tool = createScoutCoordTool({ agent: "scout-1", db: () => db, dbPath: tsDb });
    for (const [pyArgs, tsArgs] of [
      [["doctor"], { command: "doctor" }],
      [["doctor", "--json"], { command: "doctor", json: true }],
    ] as const) {
      const py = python("scout_coord.py", [...pyArgs], { JHT_DB: pyDb });
      const ts = await native(tool, tsArgs);
      expect(norm(ts.content, tsDb), pyArgs.join(" ")).toBe(norm(py.stdout, pyDb));
    }
    db.close();
  });
});

describe.skipIf(!HAS_PYTHON)("feedback_query ↔ feedback_query.py check", () => {
  it("answers from jobs.db with the script's JSON, sanitised display included", async () => {
    const pyDb = join(root, "py", "jobs.db");
    const tsDb = join(root, "ts", "jobs.db");
    for (const path of [pyDb, tsDb]) {
      const db = openJobsDb(path);
      db.prepare("INSERT INTO positions (id, title, company) VALUES (?, ?, ?)").run(42, "Backend dev", "Acme");
      db.prepare("INSERT INTO positions (id, title, company) VALUES (?, ?, ?)").run(7, "Data eng", "Beta");
      const add = db.prepare(
        "INSERT INTO position_feedback (position_id, action, reason, comment, score, direction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      add.run(42, "like", null, null, null, null, "2026-09-10 09:00:00");
      add.run(42, "dislike", "troppo senior", "vedi https://acme.example/job?id=1 e /home/me/cv.pdf — token=abc123", 2, "less_like_this", "2026-09-11 10:00:00");
      add.run(42, "hide", "  spazi   multipli\tqui ", null, null, null, "2026-09-12 11:00:00");
      add.run(7, "star", "Città perfetta, già pronto 🚀", "host: box-1 ssh me@10.0.0.5:22", 5, "more_like_this", "2026-09-13 12:00:00");
      db.close();
    }
    const db = openJobsDb(tsDb);
    const tool = createFeedbackQueryTool({ db: () => db, jhtHome });
    for (const id of ["42", "7", "99", "abc", "-3"]) {
      const py = python("feedback_query.py", ["check", id], { JHT_DB: pyDb });
      const ts = await native(tool, { command: "check", legacy_id: id });
      expect(py.status, id).toBe(0);
      expect(ts.content, id).toBe(py.stdout);
    }
    db.close();
  });

  it("with no readable database answers the script's neutral no-signal payload", async () => {
    const tool = createFeedbackQueryTool({
      db: () => {
        throw new Error("no database");
      },
    });
    const py = python("feedback_query.py", ["check", "42"], { JHT_DB: join(root, "missing", "dir", "jobs.db") });
    const ts = await native(tool, { command: "check", legacy_id: "42" });
    expect(ts.content).toBe(py.stdout);
    expect(ts.content).toContain('"note": "no-signal:cloud-disabled"');
  });
});

describe.skipIf(!HAS_PYTHON)("the display sanitiser ↔ feedback_display.py", () => {
  it("renders every tricky input exactly as Python does", () => {
    const inputs = [
      null,
      "",
      "   ",
      "troppo senior",
      "Authorization: Bearer sk-abc.def, then more",
      "bearer xyz; api_key = 'k-123' password:hunter2",
      "see https://x.example/a?b=1 and ssh://git@host:22/repo",
      "mail me@example.com:2222 or 192.168.1.10:8080",
      "hostname=box-7 session_id: s-99",
      "path \"/etc/passwd\" and 'C:\\Users\\me\\cv.docx'",
      "unc \\\\server\\share\\dir\\file.txt and C:\\temp\\x and /var/log/syslog, done",
      "${JHT_HOME}/data and JHT_HOME=/srv/jht",
      `${"/tmp"}/jht_home/cv.md`,
      "Città già: naïve café — ok",
      "résumé/2026 x/y",
      "a\u001cb\u0085c\u00a0d\u2003e\ufefff",
      "emoji 🚀🚀 and more",
      "x".repeat(300),
      `${"é".repeat(239)}🚀🚀`,
      "word " + "y".repeat(250),
      "tok token=\"quoted value\" end",
      "ok.192.0.2.4 192.0.2.4 a192.0.2.4",
      "١٢٣.١.١.١ digits",
    ];
    const home = join(root, "jht_home");
    const script = [
      "import json, sys",
      `sys.path.insert(0, ${JSON.stringify(SKILLS)})`,
      "from feedback_display import sanitize_feedback_display as s",
      "print(json.dumps([s(v) for v in json.loads(sys.stdin.read())], ensure_ascii=False))",
    ].join("\n");
    const run = spawnSync("python3", ["-c", script], {
      input: JSON.stringify(inputs.map((v) => (v === `${"/tmp"}/jht_home/cv.md` ? `${home}/cv.md` : v))),
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1", JHT_HOME: home },
    });
    expect(run.status, run.stderr).toBe(0);
    const expected = JSON.parse(run.stdout) as Array<string | null>;
    const actual = inputs.map((v) =>
      sanitizeFeedbackDisplay(v === `${"/tmp"}/jht_home/cv.md` ? `${home}/cv.md` : v, { jhtHome: home }),
    );
    inputs.forEach((input, i) => expect(actual[i], JSON.stringify(input)).toBe(expected[i]));
  });
});

describe("email_monitor", () => {
  it.skipIf(!HAS_PYTHON)("answers status, count and poll exactly as the script does with no mailbox", async () => {
    mkdirSync(join(jhtHome, "state"));
    writeFileSync(join(jhtHome, "state", "email_monitor_seen.json"), JSON.stringify({ seen_message_ids: ["<a@x>", "<b@x>"] }));
    const tool = createEmailMonitorTool({ jhtHome });
    for (const args of [["status"], ["count"], ["count", "--since-days", "3"], ["poll"], ["poll", "--since-days", "1"]]) {
      const py = python("email_monitor.py", args, {});
      const ts = await native(tool, { command: args[0], ...(args[2] ? { since_days: Number(args[2]) } : {}) });
      expect(py.status, args.join(" ")).toBe(0);
      expect(ts.content, args.join(" ")).toBe(py.stdout);
      expect(ts.ok).toBe(true);
    }
  });

  it("never opens the credentials file, and says the mailbox is unavailable here rather than not set up", async () => {
    mkdirSync(join(jhtHome, "credentials"));
    const creds = join(jhtHome, "credentials", "email_monitor.json");
    writeFileSync(creds, JSON.stringify({ user: "someone@example.com", password: "app-password" }));
    chmodSync(creds, 0o000);
    try {
      const result = await native(createEmailMonitorTool({ jhtHome }), { command: "status" });
      const status = JSON.parse(result.content) as Record<string, unknown>;
      expect(status).toMatchObject({ configured: false, creds_exists: true, note: IMAP_UNAVAILABLE_NOTE, user: "" });
      expect(result.content).not.toContain("app-password");
      expect(result.content).not.toContain("someone@example.com");
    } finally {
      chmodSync(creds, 0o600);
    }
  });
});

describe("scout_coord — boundaries", () => {
  it("takes no path from the model, and the schema refuses one", () => {
    const tool = createScoutCoordTool({ agent: "scout-1", db: () => openJobsDb(":memory:"), dbPath: ":memory:" });
    expect(tool.spec.schema.safeParse({ command: "show", db: "/tmp/other.db" }).success).toBe(false);
    expect(tool.spec.schema.safeParse({ command: "drop table" }).success).toBe(false);
  });

  it("stores a hostile job id as data, never as SQL", async () => {
    const db = openJobsDb(":memory:");
    const tool = createScoutCoordTool({ agent: "scout-1", db: () => db, dbPath: ":memory:" });
    const hostile = "x'); DROP TABLE scout_claims; --";
    expect((await native(tool, { command: "claim", job_id: hostile, scout: "scout-1" })).content).toBe("CLAIMED by scout-1");
    expect((await native(tool, { command: "check-claim", job_id: hostile })).content).toMatch(/^CLAIMED by scout-1 at /);
    expect(dump(db, "scout_claims")).toHaveLength(1);
  });

  it("reports an unusable database as a failed call, with the script's instruction not to make another", async () => {
    const tool = createScoutCoordTool({
      agent: "scout-1",
      db: () => {
        throw new Error("unable to open database file");
      },
      dbPath: "/data/jobs.db",
    });
    const result = await native(tool, { command: "show" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("scout coordination unusable in /data/jobs.db: unable to open database file");
    expect(result.content).toContain("Do NOT create a database of your own");
  });
});

describe("scout_coord is bound to the Scout that runs it (SICUREZZA D-2)", () => {
  const setup = () => {
    const db = openJobsDb(":memory:");
    const as = (agent: string) => createScoutCoordTool({ agent, db: () => db, dbPath: ":memory:" });
    return { db, one: as("scout-1"), two: as("scout-2") };
  };

  it("refuses to assign or claim in another Scout's name, and writes nothing", async () => {
    const { db, one } = setup();
    const assign = await native(one, { command: "assign", scout: "scout-2", fonti: "linkedin" });
    const claim = await native(one, { command: "claim", job_id: "https://jobs.example/9", scout: "scout-2" });
    for (const result of [assign, claim]) {
      expect(result.ok).toBe(false);
      expect(result.content).toContain("you are scout-1");
      expect(result.content).toContain("'scout-2'");
    }
    expect(dump(db, "scout_coordination")).toEqual([]);
    expect(dump(db, "scout_claims")).toEqual([]);
  });

  it("takes the caller's own name when none is given, in any case", async () => {
    const { db, one } = setup();
    expect((await native(one, { command: "claim", job_id: "https://jobs.example/9" })).content).toBe("CLAIMED by scout-1");
    expect((await native(one, { command: "assign", scout: "SCOUT-1", cerchi: "1" })).content).toBe(
      "Assigned: scout-1 → search_areas=1, sources=None",
    );
    expect(db.prepare("SELECT scout FROM scout_claims").all()).toEqual([{ scout: "scout-1" }]);
    expect(db.prepare("SELECT scout FROM scout_coordination").all()).toEqual([{ scout: "scout-1" }]);
  });

  it("checks the name a claim is made in", async () => {
    const { db, one } = setup();
    const result = await native(one, { command: "claim", job_id: "https://jobs.example/9", scout: "--help" });
    expect(result).toMatchObject({ ok: false, content: expect.stringContaining("'--help' is not a Scout name") });
    expect(dump(db, "scout_claims")).toEqual([]);
  });

  it("resets only the caller's own split and old claims", async () => {
    const { db, one, two } = setup();
    await native(one, { command: "assign", cerchi: "1" });
    await native(two, { command: "assign", cerchi: "2" });
    const old = db.prepare("INSERT INTO scout_claims (job_id, scout, claimed_at) VALUES (?, ?, datetime('now', '-2 days'))");
    old.run("https://jobs.example/old-1", "scout-1");
    old.run("https://jobs.example/old-2", "scout-2");

    expect((await native(one, { command: "reset" })).content).toBe("Session closed: 1 assignments archived.");
    expect(db.prepare("SELECT scout FROM scout_coordination WHERE superseded_at IS NULL").all()).toEqual([{ scout: "scout-2" }]);
    expect(db.prepare("SELECT job_id FROM scout_claims").all()).toEqual([{ job_id: "https://jobs.example/old-2" }]);
  });

  it("cannot be built for an agent that is not a Scout name", () => {
    expect(() => createScoutCoordTool({ agent: "../capitano", db: () => openJobsDb(":memory:"), dbPath: ":memory:" })).toThrow();
  });
});
