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
import { fakeDiskNodeOptions } from "./fake-disk";

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
  // a host start needs the CLI of the provider the team chose: there is no default one
  writeFileSync(path.join(home, "jht.config.json"), '{"active_provider":"openai"}', "utf-8");
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
if (command[0] === "bash" && command[1] === "-c" && command[2].includes("providers check-key")) {
  // the provider refuses the key (a 401): the CLI of the container says so on stderr and exits 3
  if (process.env.FAKE_KEY_CHECK === "rejected") {
    console.error("GLM (Z.ai) rejected the API key (HTTP 401: wrong, expired or revoked). Put the right one in its file and run: jht setup");
    process.exit(3);
  }
  // the same refusal, with control characters in the line (bell, backspace, a color): none of them may reach the terminal
  if (process.env.FAKE_KEY_CHECK === "control") {
    console.error("\x1b[31mGLM (Z.ai)\x07 rejected\x08 the API key (HTTP 401).\x1b[0m");
    process.exit(3);
  }
  // a CLI that does not know the command, a crash: exit 1, and it is no verdict on the key
  if (process.env.FAKE_KEY_CHECK === "broken") {
    console.error("error: unknown command 'check-key'");
    process.exit(1);
  }
  process.exit(0);
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
  const successful = (process.env.FAKE_START_SUCCESS_ROLES || "")
    .split(",")
    .filter(Boolean);
  if (successful.includes(role) || successful.includes("*")) process.exit(0);
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
  writeExecutable(path.join(bin, "codex"), "process.exit(0);");
  return {
    nodeOptions: fakeDiskNodeOptions(root),
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
      // Disco finto e sano (50%): il guard del 3% di `team start` non deve
      // dipendere dal volume della macchina. `env` puo' abbassarlo.
      NODE_OPTIONS: sb.nodeOptions,
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

// A start of the whole team, with every role starting, runs the fake docker once per step of every agent (about 50 ms each on
// an idle machine). Measured on the same commit parent and on the commit that made the roles start all (FAKE_START_SUCCESS_ROLES
// "*"), idle: 5-7 s before, 10-15 s after on the CI machines, and 16 s when the machine is busy. The ceiling of 15 s left no margin
// for the slowest machine: 30 s is twice the slowest measure, and a real hang is still caught by it.
const FULL_START_TIMEOUT_MS = 30_000;

describe("team halt gate — CLI host verso runtime container", () => {
  it("stop crea il gate nel container e start globale lo rimuove prima dello spawn", () => {
    const sb = sandbox();
    const stopped = run(sb, ["stop", "--all"], {
      FAKE_CONTAINER_SESSIONS: "SCOUT-1",
    });
    expect(stopped.status, stopped.stderr).toBe(0);
    expect(existsSync(sb.flag)).toBe(true);

    const started = run(sb, ["start"], {
      FAKE_START_SUCCESS_ROLES: "*",
    });
    expect(started.status, `${started.stdout}\n${started.stderr}`).toBe(0);
    expect(existsSync(sb.flag)).toBe(false);
    expect(started.stdout).toMatch(/[1-9]\d* started/);
    const log = dockerLog(sb);
    const removedAt = log.findIndex((row) => row.command[0] === "rm");
    const launchedAt = log.findIndex(
      (row) => row.command[1] === "/app/.launcher/start-agent.sh",
    );
    expect(removedAt).toBeGreaterThan(-1);
    expect(launchedAt).toBeGreaterThan(removedAt);
    expect(log[launchedAt].flag).toBe(false);
  }, 45_000);

  it.each(["error", "residual"])(
    "un rm %s blocca lo start senza dichiarare agenti avviati",
    (mode) => {
      const sb = sandbox();
      writeFileSync(sb.flag, "halted");
      const result = run(sb, ["start"], {
        FAKE_RM_MODE: mode,
        FAKE_START_SUCCESS_ROLES: "capitano",
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

  it("chiave API rifiutata dal provider: lo start si ferma col perché, rc 1, niente parte e lo stop resta (D2)", () => {
    const sb = sandbox();
    writeFileSync(sb.flag, "halted");
    const result = run(sb, ["start"], { FAKE_KEY_CHECK: "rejected", FAKE_START_SUCCESS_ROLES: "*" });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.stderr).toContain("GLM (Z.ai) rejected the API key (HTTP 401");
    expect(result.stderr).toContain("jht setup");
    expect(result.stdout).not.toMatch(/\d+ started/);
    expect(result.stdout).not.toContain("Team on:");
    // nothing launched, and the stop of the person is still there
    expect(dockerLog(sb).some((row) => row.command[1] === "/app/.launcher/start-agent.sh")).toBe(false);
    expect(existsSync(sb.flag)).toBe(true);
    // the key was asked INSIDE the container, where the file of the key is
    expect(dockerLog(sb).some((row) => String(row.command[2]).includes("jht.js providers check-key"))).toBe(true);

    // the sentence names the way out of a false refusal
    expect(result.stderr).toContain("jht team start --skip-key-check");

    // an older image that does not know the command exits 1: that is not a refused key
    const broken = run(sb, ["start"], { FAKE_KEY_CHECK: "broken", FAKE_START_SUCCESS_ROLES: "*" });
    expect(broken.status, `${broken.stdout}\n${broken.stderr}`).toBe(0);
    expect(existsSync(sb.flag)).toBe(false);

    // a key that is not refused (or could not be tried) never stops a start
    writeFileSync(sb.flag, "halted");
    const ok = run(sb, ["start"], { FAKE_START_SUCCESS_ROLES: "*" });
    expect(ok.status, `${ok.stdout}\n${ok.stderr}`).toBe(0);
    expect(existsSync(sb.flag)).toBe(false);
  }, 45_000);

  it("via d'uscita da un 401 falso: --skip-key-check o JHT_SKIP_KEY_CHECK, e i caratteri di controllo non arrivano al terminale (D2)", () => {
    const sb = sandbox();
    writeFileSync(sb.flag, "halted");
    // the way out: the flag, or the variable for what starts the team on someone's behalf; the check is not even asked
    for (const way of [{ args: ["start", "--skip-key-check"], env: {} }, { args: ["start"], env: { JHT_SKIP_KEY_CHECK: "1" } }]) {
      const skipped = run(sb, way.args, { FAKE_KEY_CHECK: "rejected", FAKE_START_SUCCESS_ROLES: "*", ...way.env });
      expect(skipped.status, `${skipped.stdout}\n${skipped.stderr}`).toBe(0);
      expect(skipped.stdout).toMatch(/Team on: \d+ started/);
      writeFileSync(sb.flag, "halted");
    }
    const asked = dockerLog(sb).filter((row) => String(row.command[2]).includes("jht.js providers check-key")).length;
    expect(asked).toBe(0);

    // control characters of the line the container wrote never reach the terminal
    const control = run(sb, ["start"], { FAKE_KEY_CHECK: "control", FAKE_START_SUCCESS_ROLES: "*" });
    expect(control.status).toBe(1);
    expect(control.stderr).toContain("GLM (Z.ai) rejected the API key (HTTP 401).");
    expect(control.stderr).not.toMatch(/[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/);
  }, 90_000);

  it("start singolo preserva il gate globale", () => {
    const sb = sandbox();
    writeFileSync(sb.flag, "halted");
    const result = run(sb, ["start", "scout"], {
      FAKE_START_SUCCESS_ROLES: "scout",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("1 started");
    expect(existsSync(sb.flag)).toBe(true);
    expect(dockerLog(sb).some((row) => row.command[0] === "rm")).toBe(false);
  });

  it("lo start del team numera i passi, dice quando ha finito e cosa fare adesso; il singolo agente non numera", () => {
    const sb = sandbox();
    const all = run(sb, ["start"], { FAKE_START_SUCCESS_ROLES: "*" });
    expect(all.status, `${all.stdout}\n${all.stderr}`).toBe(0);
    expect(all.stdout).toMatch(/\[1\/\d\]/);
    expect(all.stdout).toMatch(/\[\d\/(\d)\].*CAPITANO started|\[\d\/\d\] .*✓ CAPITANO started/);
    expect(all.stdout).toMatch(/Team on: \d+ started in \d+ s/);
    expect(all.stdout).not.toContain("errors");
    expect(all.stdout).not.toContain("NOT fully on");
    expect(all.stdout).toContain("See how it is going with: jht agents");

    const sb2 = sandbox();
    const one = run(sb2, ["start", "scout"], { FAKE_START_SUCCESS_ROLES: "scout" });
    expect(one.status, `${one.stdout}\n${one.stderr}`).toBe(0);
    expect(one.stdout).not.toMatch(/\[\d\/\d\]/);
    expect(one.stdout).not.toContain("Team on:");
  }, 45_000);

  it("bootstrap parziale con CAPITANO fallito non dichiara successo", () => {
    const sb = sandbox();
    const result = run(sb, ["start"], {
      // Riproduzione #129: altri componenti core partono, il marker minimo
      // operativo no. Il watchdog potrà recuperarli, ma questo comando deve
      // restituire l'errore e il suo output al chiamante.
      FAKE_START_SUCCESS_ROLES: "mentor",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("1 started");
    expect(result.stdout).toContain("CAPITANO — synthetic launch failure");
    // five: the sandbox has no Telegram bot, so the bootstrap has no TG-BRIDGE (JHT-T306)
    expect(result.stdout).toContain("5 errors");
  }, FULL_START_TIMEOUT_MS);

  it("CAPITANO già attivo attesta il bootstrap anche se lo spawn è skipped", () => {
    const sb = sandbox();
    const result = run(sb, ["start"], {
      // CAPITANO esiste nel runtime ed è il marker operativo canonico usato
      // anche dal probe del gioco: il bootstrap non è negato dagli altri
      // errori, ma NEPPURE li nasconde col codice 0 (D3 del collaudo del 10/11:
      // «1 errors» con exit 0 = uno script crede che sia tutto a posto).
      FAKE_CONTAINER_SESSIONS: "CAPITANO",
      FAKE_START_SUCCESS_ROLES: "assistente,sentinella,bridge,token-meter,mentor",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("CAPITANO — already active");
    expect(result.stdout).toContain("1 already active");
    expect(result.stdout).not.toContain("errors");
    // Stesso budget degli altri due bootstrap completi del file. Qui non c'e'
    // nessuna attesa (nulla parte, quindi nessun preDelayMs): il tempo e' tutto
    // processi, 63 invocazioni del docker finto da ~50ms l'una, ~3,5s a
    // macchina scarica. Col default di 5s il margine era 1,5s e il test andava
    // rosso con qualunque carico: 16 run su 20 sotto 8 processi CPU-bound,
    // tutte su questo caso.
  }, FULL_START_TIMEOUT_MS);

  it("un agente che non parte = codice di uscita 1 e frase chiara, anche col CAPITANO a posto (D3)", () => {
    const sb = sandbox();
    const result = run(sb, ["start"], {
      FAKE_CONTAINER_SESSIONS: "CAPITANO",
      // solo l'ASSISTENTE fallisce (come «command 'codex' not found»): il resto parte
      FAKE_START_SUCCESS_ROLES: "sentinella,bridge,token-meter,mentor",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.stdout).toContain("ASSISTENTE — synthetic launch failure");
    expect(result.stdout).toContain("1 errors");
    expect(result.stdout).toContain("The team is NOT fully on: 1 did not start");
    expect(result.stdout).toContain("jht team start");
    // un avvio andato male non si presenta come riuscito
    expect(result.stdout).not.toContain("Team on:");
    expect(result.stdout).not.toContain("See how it is going");
  }, FULL_START_TIMEOUT_MS);

  it("start di un singolo agente che fallisce: exit 1 e la stessa frase", () => {
    const sb = sandbox();
    const result = run(sb, ["start", "scout"], { FAKE_START_SUCCESS_ROLES: "" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
    expect(result.stdout).toContain("The team is NOT fully on: 1 did not start");
  }, 15_000);

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

  it("sotto il 3% di disco libero lo start rifiuta con disk_low e non lancia niente", () => {
    const sb = sandbox();
    const single = run(sb, ["start", "scout"], {
      FAKE_STATFS_FREE_PCT: "2",
      FAKE_START_SUCCESS_ROLES: "scout",
    });
    expect(single.status, `${single.stdout}\n${single.stderr}`).toBe(1);
    expect(single.stdout).toContain("disk_low");
    expect(
      dockerLog(sb).some((row) => row.command[1] === "/app/.launcher/start-agent.sh"),
    ).toBe(false);

    const all = run(sb, ["start"], {
      FAKE_STATFS_FREE_PCT: "2",
      FAKE_START_SUCCESS_ROLES: "capitano",
    });
    expect(all.status, `${all.stdout}\n${all.stderr}`).toBe(1);
    expect(all.stdout).toContain("disk_low");
    expect(
      dockerLog(sb).some((row) => row.command[1] === "/app/.launcher/start-agent.sh"),
    ).toBe(false);
  }, 15_000);

  it("all'8% di disco libero lo start parte: l'avviso non ferma niente", () => {
    const sb = sandbox();
    const result = run(sb, ["start", "scout"], {
      FAKE_STATFS_FREE_PCT: "8",
      FAKE_START_SUCCESS_ROLES: "scout",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("1 started");
  }, 15_000);
});
