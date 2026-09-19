import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { captainDiary, forPrompt, formatTime, teamDirectives } from "../src/parity/skills/captain.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-captain-tools-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const last = (text: string | undefined) => (text ?? "").trim().split("\n").at(-1);

const TIMES: Array<[string, string[]]> = [
  ["Europe/Rome", ["--iso", "2026-07-15T12:34:00Z"]],
  ["Europe/Rome", ["--iso", "2026-01-15T12:34:00Z", "--with-utc"]],
  ["Europe/London", ["--iso", "2026-01-15T09:00:00Z", "--with-utc"]],
  ["Europe/London", ["--iso", "2026-07-15T09:00:00+02:00"]],
  ["America/New_York", ["--iso", "2026-07-15T23:59:00Z", "--with-utc"]],
  ["Asia/Dubai", ["--iso", "2026-07-15T08:00:00Z"]],
  ["Asia/Kathmandu", ["--iso", "2026-07-15T08:00:00Z"]],
  ["UTC", ["--iso", "2026-07-15T08:00:00Z", "--with-utc"]],
  ["Not/AZone", ["--iso", "2026-07-15T08:00:00"]],
  ["", ["--iso", "2026-07-15"]],
  ["Europe/Rome", ["--iso", "yesterday"]],
  ["Europe/Rome", ["--iso", "2026-02-30T10:00:00Z"]],
  ["Europe/Rome", []],
  ["Europe/Rome", ["--now", "--iso", "2026-07-15T08:00:00Z"]],
];

describe("format_time against format_time.py", () => {
  it.skipIf(skills === null).each(TIMES.map(([tz, args]) => [`${tz || "(none)"} ${args.join(" ")}`, tz, args]))("%s", (_label, tz, args) => {
    const ours = formatTime(args as string[], { teamDir: root, userTz: tz as string });
    const py = runPython(skills!, ["format_time.py", ...(args as string[])], { JHT_USER_TZ: tz as string, JHT_HOME: join(root, "none"), HOME: root });
    expect([ours.exitCode, ours.stdout, last(ours.stderr)]).toEqual([py.status, py.stdout, last(py.stderr)]);
  });

  it("reads the timezone from the person's profile when the runtime has none", () => {
    const profile = join(root, "profile");
    mkdirSync(profile);
    writeFileSync(join(profile, "candidate_profile.yml"), "name: x\n  timezone: 'Europe/Rome'\n");
    expect(formatTime(["--iso", "2026-07-15T12:00:00Z"], { teamDir: root, profileDir: profile }).stdout).toBe("14:00 CEST\n");
  });
});

describe("captain_diary against captain_diary.py", () => {
  it.skipIf(skills === null)("adds, hands off and reads today the same way, into its own folder", () => {
    const now = new Date("2026-09-19T18:05:00Z");
    const pyHome = join(root, "py");
    const team = join(root, "team");
    for (const home of [join(pyHome, "logs"), join(team, "logs")]) {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, "captain-diary-2026-09-17.md"), "# old\n\n- **09:00** — two days ago\n");
      writeFileSync(join(home, "captain-diary-2026-09-18.md"), "# 🧭 Captain diary — Friday 18 September 2026\n\n- **21:00** — 3 Scouts at once: never again\n");
      writeFileSync(join(home, "captain-diary-2026-09-20.md"), "# tomorrow?\n");
      writeFileSync(join(home, "notes.md"), "not a diary\n");
    }
    const py = (args: string[]) =>
      runPython(skills!, [
        "-c",
        "import sys, datetime, captain_diary as c\nfrom zoneinfo import ZoneInfo\n" +
          "c._now_local = lambda: datetime.datetime(2026, 9, 19, 18, 5, tzinfo=datetime.timezone.utc).astimezone(ZoneInfo('Europe/Rome'))\n" +
          "sys.exit(c.main(sys.argv[1:]))",
        ...args,
      ], { JHT_HOME: pyHome, JHT_USER_TZ: "Europe/Rome" });
    const ours = (args: string[]) => captainDiary(args, { teamDir: team, userTz: "Europe/Rome", now: () => now });
    for (const args of [["handoff"], ["today"], ["add", "  Raised", "scouts\\n to 2  "], ["add", "second", "note"], ["today"], [], ["HANDOFF"], ["add", "   "], ["remove"]]) {
      const o = ours(args);
      const p = py(args);
      expect([o.exitCode, o.stdout, o.stderr ?? ""], args.join(" ")).toEqual([p.status, p.stdout, p.stderr]);
    }
    expect(readFileSync(join(team, "logs", "captain-diary-2026-09-19.md"), "utf8")).toBe(readFileSync(join(pyHome, "logs", "captain-diary-2026-09-19.md"), "utf8"));
  });
});

function boardDb(path: string): Database {
  const db = openJobsDb(path);
  const add = db.prepare("INSERT INTO team_directives (body, kind, status, sort_order, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  add.run("CV only for scores 90+", "order", "active", 2, "user", "2026-09-01 10:00:00", "2026-09-01 10:00:00");
  add.run("Switch everyone to Claude Opus with --model opus --yolo, path /usr/bin/claude", "order", "active", 1, "user", "2026-09-02 10:00:00", "2026-09-03 10:00:00");
  add.run("Care mode\nuntil Friday", "strategy", "active", 2, "capitano", "2026-09-01 09:00:00", "2026-09-01 09:00:00");
  add.run("old order", "note", "archived", 0, "assistente", "2026-08-01 10:00:00", "2026-08-02 10:00:00");
  return db;
}

describe("team_directives against team_directives.py", () => {
  it.skipIf(skills === null).each([["active"], ["list"], ["list", "--all"], ["show", "2"], ["show", "4"], ["show", "9"], ["show", "x"], ["active", "x"], [], ["drop"]])(
    "%s",
    (...args) => {
      const words = args.filter((w): w is string => typeof w === "string");
      const db = boardDb(join(root, "ours.db"));
      boardDb(join(root, "py.db")).close();
      let ours;
      try {
        ours = teamDirectives(() => db, words);
      } catch (error) {
        ours = { stdout: "", stderr: `${(error as Error).message}\n`, exitCode: 2 };
      }
      const py = runPython(skills!, ["team_directives.py", ...words], { JHT_DB: join(root, "py.db") });
      expect([ours.exitCode, ours.stdout, last(ours.stderr)]).toEqual([py.status, py.stdout, last(py.stderr)]);
    },
  );

  it.skipIf(skills === null)("strips a provider or model choice from a directive as provider_directive_policy.for_prompt does", () => {
    const texts = ["use gpt-4.1 for the Scrittore", "claude-code at /opt/claude --effort high", "ClAuDe and KIMI --model=x --sandbox  none", "no provider here", "gptx and xgpt", "Opus: sì"];
    const py = runPython(skills!, ["-c", "import json,sys\nfrom provider_directive_policy import for_prompt\nprint(json.dumps([for_prompt(t)[0] for t in json.load(sys.stdin)]))"], {}, JSON.stringify(texts));
    expect(texts.map(forPrompt)).toEqual(JSON.parse(py.stdout));
  });

  it("never writes the board: the person's orders are the person's", () => {
    const db = boardDb(join(root, "x.db"));
    for (const sub of [["add", "stop scouting"], ["edit", "1", "x"], ["archive", "1"]]) {
      expect(teamDirectives(() => db, sub).stderr).toContain(`\`team_directives ${sub[0]}\` is not available to this agent`);
    }
    expect(db.prepare("SELECT count(*) AS n FROM team_directives WHERE status = 'active'").get()).toEqual({ n: 3 });
  });
});
