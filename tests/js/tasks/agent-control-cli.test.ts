import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// `jht agent-control`: the desktop app's way to the agents' control panel on a
// local team. The command only checks the shape and passes it on, as argv, to
// shared/skills/agent_control.py in the container; a shape it does not know
// never reaches the container. A fake docker stands in for the container, and
// a fake tmux for the team: nothing here touches a real one.
const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");
const SCRIPT = "/app/shared/skills/agent_control.py";
const sandboxes: string[] = [];

function writeExecutable(file: string, body: string) {
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, "utf-8");
  chmodSync(file, 0o755);
}

function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), "jht-agent-control-"));
  sandboxes.push(root);
  const bin = path.join(root, "bin");
  const home = path.join(root, "jht_home");
  const sessions = path.join(root, "sessions");
  for (const dir of [bin, home, sessions, path.join(root, "tmux-tmp")]) mkdirSync(dir, { recursive: true });
  writeExecutable(
    path.join(bin, "docker"),
    String.raw`
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Docker version fake"); process.exit(0); }
if (args[0] === "ps") { if (!process.env.FAKE_DOCKER_DOWN) console.log("jht"); process.exit(0); }
if (args[0] !== "exec") process.exit(2);
const command = args.slice(args.indexOf("jht") + 1);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(command) + "\n");
if (process.env.FAKE_RUN_SCRIPT) {
  // The real script, from the repo, against the fake team.
  const argv = command.map((a) => (a === "${SCRIPT}" ? process.env.FAKE_RUN_SCRIPT : a));
  const done = spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
  process.exit(done.status ?? 1);
}
if (process.env.FAKE_REPLY) process.stdout.write(process.env.FAKE_REPLY + "\n");
process.exit(Number(process.env.FAKE_EXIT || 0));
`,
  );
  // A tmux that keeps its sessions as files.
  writeExecutable(
    path.join(bin, "tmux"),
    String.raw`
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.FAKE_SESSIONS;
const args = process.argv.slice(2);
const target = (t) => t.replace(/^=/, "").split(":")[0];
if (args[0] === "has-session") process.exit(fs.existsSync(path.join(dir, target(args[2]))) ? 0 : 1);
if (args[0] === "kill-session") { fs.rmSync(path.join(dir, target(args[2])), { force: true }); process.exit(0); }
if (args[0] === "list-sessions") { for (const f of fs.readdirSync(dir)) console.log(f + "\t100\t200"); process.exit(0); }
process.exit(0);
`,
  );
  return { root, bin, home, sessions, log: path.join(root, "docker.jsonl") };
}

function run(sb: ReturnType<typeof sandbox>, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [JHT_BIN, "agent-control", ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${sb.bin}${path.delimiter}${process.env.PATH}`,
      JHT_HOME: sb.home,
      JHT_CONTAINER_NAME: "jht",
      TMUX_TMPDIR: path.join(sb.root, "tmux-tmp"),
      TMUX: "",
      FAKE_LOG: sb.log,
      FAKE_SESSIONS: sb.sessions,
      NO_COLOR: "1",
      ...env,
    },
  });
}

function execs(sb: ReturnType<typeof sandbox>): string[][] {
  if (!existsSync(sb.log)) return [];
  return readFileSync(sb.log, "utf-8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("jht agent-control", () => {
  it.each([
    [["stop", "SCOUT-1"]],
    [["start", "CRITICO"]],
    [["restart", "CLOSER-1"]],
    [["screen", "CRITICO-S3"]],
    [["pause", "--for-hours", "4"]],
    [["pause", "--until", "2026-10-20T06:00:00Z"]],
    [["pause", "--wake-on-weekly"]],
    [["resume"]],
    [["list"]],
    [["team"]],
  ])("passes %j on to the script as argv, and its answer and code back", (args) => {
    const sb = sandbox();
    const reply = JSON.stringify({ ok: false, op: args[0], error: "agent_contained" });
    const done = run(sb, args, { FAKE_REPLY: reply, FAKE_EXIT: "111" });
    expect(execs(sb)).toEqual([["python3", SCRIPT, ...args]]);
    expect(done.stdout.trim()).toBe(reply);
    expect(done.status).toBe(111);
  });

  it.each([
    [[]],
    [["stop"]],
    [["stop", "scout-1"]],
    [["stop", "SCOUT-01"]],
    [["stop", "SCOUT-1;rm -rf /"]],
    [["stop", "SCOUT-1", "--force"]],
    [["stop", "SCOUT-1", "SCOUT-2"]],
    [["send", "SCOUT-1", "hello"]],
    [["--wake-on-weekly", "pause"]],
    [["pause"]],
    [["pause", "--for-hours", "0"]],
    [["pause", "--for-hours", "169"]],
    [["pause", "--for-hours", "4", "--wake-on-weekly"]],
    [["pause", "--until", "tomorrow"]],
    [["pause", "--until", "2026-10-20T06:00:00"]],
    [["resume", "now"]],
    [["list", "--all"]],
    [["--help"]],
  ])("refuses %j before the container", (args) => {
    const sb = sandbox();
    const done = run(sb, args);
    expect(execs(sb)).toEqual([]);
    expect(JSON.parse(done.stdout.trim())).toEqual({ ok: false, error: "agent_control_invalid" });
    expect(done.status).toBe(100);
  });

  it("says there is no team when the container is not running", () => {
    const sb = sandbox();
    const done = run(sb, ["stop", "SCOUT-1"], { FAKE_DOCKER_DOWN: "1" });
    expect(execs(sb)).toEqual([]);
    expect(JSON.parse(done.stdout.trim())).toEqual({ ok: false, error: "agent_control_no_team" });
    expect(done.status).toBe(113);
  });

  it("with the real script, a stop holds the agent for the user and kills it", () => {
    const sb = sandbox();
    writeFileSync(path.join(sb.sessions, "SCOUT-1"), "");
    writeFileSync(path.join(sb.sessions, "CAPITANO"), "");
    const done = run(sb, ["stop", "SCOUT-1"], {
      FAKE_RUN_SCRIPT: path.join(REPO, "shared", "skills", "agent_control.py"),
      PYTHONDONTWRITEBYTECODE: "1",
    });
    expect(JSON.parse(done.stdout.trim())).toEqual({ ok: true, op: "stop", session: "SCOUT-1", result: "stopped" });
    expect(done.status).toBe(0);
    expect(existsSync(path.join(sb.sessions, "SCOUT-1"))).toBe(false);
    expect(existsSync(path.join(sb.sessions, "CAPITANO"))).toBe(true);
    const roster = JSON.parse(readFileSync(path.join(sb.home, "logs", "team-roster.json"), "utf-8"));
    expect(roster.agents["SCOUT-1"]).toMatchObject({ status: "contained", contained_by: "user" });
  });
});
