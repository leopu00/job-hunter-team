import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");
const sandboxes: string[] = [];

function writeExecutable(file: string, body: string) {
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, "utf-8");
  chmodSync(file, 0o755);
}

function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), "jht-team-halt-start-"));
  sandboxes.push(root);
  const bin = path.join(root, "bin");
  const home = path.join(root, "host-home");
  const state = path.join(root, "container-state");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeExecutable(
    path.join(bin, "docker"),
    String.raw`
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (process.env.FAKE_DOCKER_DISABLED === "1") process.exit(1);
const state = process.env.FAKE_CONTAINER_STATE;
const flag = path.join(state, "team-halted.flag");
const log = path.join(state, "docker.jsonl");
function record(command) {
  fs.appendFileSync(log, JSON.stringify({ command, flag: fs.existsSync(flag) }) + "\n");
}
if (args[0] === "--version") {
  console.log("Docker version fake");
  process.exit(0);
}
if (args[0] === "ps") {
  console.log("jht");
  process.exit(0);
}
if (args[0] !== "exec") process.exit(2);
const containerAt = args.indexOf("jht");
const command = args.slice(containerAt + 1);
record(command);
if (command[0] === "touch" && command[1] === "/jht_home/.team-halted.flag") {
  fs.writeFileSync(flag, "halted");
  process.exit(0);
}
if (command[0] === "rm" && command.at(-1) === "/jht_home/.team-halted.flag") {
  if (process.env.FAKE_RM_MODE === "error") {
    console.error("synthetic rm failure");
    process.exit(1);
  }
  if (process.env.FAKE_RM_MODE !== "residual") fs.rmSync(flag, { force: true });
  process.exit(0);
}
if (command[0] === "test" && command.join(" ") === "test ! -e /jht_home/.team-halted.flag") {
  process.exit(fs.existsSync(flag) ? 1 : 0);
}
if (command[0] === "bash" && command[1] === "-c") {
  if (command[2].includes("tmux list-sessions")) {
    const sessions = process.env.FAKE_CONTAINER_SESSIONS || "";
    if (sessions) console.log(sessions.split(",").join("\n"));
  }
  process.exit(0);
}
if (command[0] === "tmux" && command[1] === "kill-session") process.exit(0);
if (command[0] === "bash" && command[1] === "/app/.launcher/start-agent.sh") {
  const role = command[2] || "";
  if (role === process.env.FAKE_START_SUCCESS_ROLE) process.exit(0);
  console.error("synthetic launch failure");
  process.exit(1);
}
process.exit(0);
`,
  );
  writeExecutable(
    path.join(bin, "tmux"),
    String.raw`
const args = process.argv.slice(2);
if (args[0] === "list-sessions") {
  const sessions = process.env.FAKE_HOST_SESSIONS || "";
  if (sessions) console.log(sessions.split(",").join("\n"));
}
process.exit(0);
`,
  );
  writeExecutable(path.join(bin, "claude"), "process.exit(0);");
  return {
    root,
    home,
    state,
    bin,
    flag: path.join(state, "team-halted.flag"),
    log: path.join(state, "docker.jsonl"),
  };
}

function run(
  sb: ReturnType<typeof sandbox>,
  args: string[],
  env: Record<string, string> = {},
) {
  return spawnSync(process.execPath, [JHT_BIN, "team", ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${sb.bin}${path.delimiter}${process.env.PATH}`,
      JHT_HOME: sb.home,
      JHT_CONTAINER_NAME: "jht",
      FAKE_CONTAINER_STATE: sb.state,
      NO_COLOR: "1",
      ...env,
    },
  });
}

function dockerLog(sb: ReturnType<typeof sandbox>) {
  if (!existsSync(sb.log)) return [];
  return readFileSync(sb.log, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { command: string[]; flag: boolean });
}

afterEach(() => {
  for (const root of sandboxes.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("team halt gate — CLI host verso runtime container", () => {
  it("stop crea il gate nel container e start globale lo rimuove prima dello spawn", () => {
    const sb = sandbox();
    const stopped = run(sb, ["stop", "--all"], {
      FAKE_CONTAINER_SESSIONS: "SCOUT-1",
    });
    expect(stopped.status, stopped.stderr).toBe(0);
    expect(existsSync(sb.flag)).toBe(true);

    const started = run(sb, ["start"], {
      FAKE_START_SUCCESS_ROLE: "capitano",
    });
    expect(started.status, `${started.stdout}\n${started.stderr}`).toBe(0);
    expect(existsSync(sb.flag)).toBe(false);
    expect(started.stdout).toContain("1 started");
    const log = dockerLog(sb);
    const removedAt = log.findIndex((row) => row.command[0] === "rm");
    const launchedAt = log.findIndex(
      (row) => row.command[1] === "/app/.launcher/start-agent.sh",
    );
    expect(removedAt).toBeGreaterThan(-1);
    expect(launchedAt).toBeGreaterThan(removedAt);
    expect(log[launchedAt].flag).toBe(false);
  }, 15_000);

  it.each(["error", "residual"])(
    "un rm %s blocca lo start senza dichiarare agenti avviati",
    (mode) => {
      const sb = sandbox();
      writeFileSync(sb.flag, "halted");
      const result = run(sb, ["start"], {
        FAKE_RM_MODE: mode,
        FAKE_START_SUCCESS_ROLE: "capitano",
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        "Unable to resume the team",
      );
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/\d+ started/);
      expect(
        dockerLog(sb).some(
          (row) => row.command[1] === "/app/.launcher/start-agent.sh",
        ),
      ).toBe(false);
    },
  );

  it("start singolo preserva il gate globale", () => {
    const sb = sandbox();
    writeFileSync(sb.flag, "halted");
    const result = run(sb, ["start", "scout"], {
      FAKE_START_SUCCESS_ROLE: "scout",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("1 started");
    expect(existsSync(sb.flag)).toBe(true);
    expect(dockerLog(sb).some((row) => row.command[0] === "rm")).toBe(false);
  });

  it("in modalità locale rimuove solo il gate sotto JHT_HOME", () => {
    const sb = sandbox();
    const localFlag = path.join(sb.home, ".team-halted.flag");
    writeFileSync(localFlag, "local halt");
    writeFileSync(sb.flag, "container halt");
    const result = run(sb, ["start"], {
      FAKE_DOCKER_DISABLED: "1",
      FAKE_HOST_SESSIONS: [
        "JHT-CAPITANO",
        "JHT-SCOUT-1",
        "JHT-ANALISTA-1",
        "JHT-SCORER-1",
        "JHT-SCRITTORE-1",
        "JHT-CRITICO",
      ].join(","),
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(localFlag)).toBe(false);
    expect(existsSync(sb.flag)).toBe(true);
    expect(result.stdout).toContain("0 started");
    expect(result.stdout).toContain("6 already active");
  });
});
