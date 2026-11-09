import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");

function writeExec(file: string, body: string) {
  writeFileSync(file, `#!/bin/sh\n${body}\n`, "utf-8");
  chmodSync(file, 0o755);
}

function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), "jht-runtime-status-"));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(home, "jht.config.json"), JSON.stringify({
    version: 4,
    active_provider: "openai",
    providers: { openai: { auth_method: "subscription" } },
  }), "utf-8");
  writeExec(path.join(bin, "tmux"), [
    "case \"$*\" in",
    "  *list-sessions*) printf 'ASSISTENTE\\nCAPITANO\\nMENTOR\\nSENTINELLA\\nSCOUT-1\\nunrelated\\n' ;;",
    "  *) echo 'tmux 3.5' ;;",
    "esac",
  ].join("\n"));
  writeExec(path.join(bin, "git"), "exit 1");
  return { root, home, bin };
}

function run(command: string, ...extra: string[]) {
  const sb = sandbox();
  const r = spawnSync(process.execPath, [JHT_BIN, command, ...extra], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${sb.bin}${path.delimiter}${process.env.PATH}`,
      JHT_HOME: sb.home,
      NO_COLOR: "1",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("CLI — nomi sessione del runtime container", () => {
  it("jht status conta i nomi moderni e ignora tmux estranei", () => {
    const r = run("status");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Team\s+5 running/);
    expect(r.out).toContain("SCOUT-1");
    expect(r.out).not.toContain("unrelated");
  });

  it("jht doctor riconosce i quattro agenti core moderni", () => {
    const r = run("doctor", "--all");
    for (const name of ["ASSISTENTE", "CAPITANO", "MENTOR", "SENTINELLA"]) {
      expect(r.out).toContain(`${name}: active`);
      expect(r.out).not.toContain(`${name}: not found`);
    }
  }, 15_000);
});

describe("team start — retry reattivo", () => {
  it("fa un no-op prima di sync e bridge quando tutto il core è già vivo", () => {
    const source = readFileSync(
      path.join(REPO, "cli", "src", "commands", "team", "start.js"),
      "utf-8",
    );
    const earlyNoop = source.indexOf("coreSessions.every");
    const firstCloudSync = source.indexOf("cloud pull-desired-state");
    expect(earlyNoop).toBeGreaterThan(0);
    expect(earlyNoop).toBeLessThan(firstCloudSync);
    expect(source).toContain("Team already running: no bridge or sync process restarted.");
  });

  it("applica lo stagger solo quando la voce precedente è stata avviata", () => {
    const source = readFileSync(
      path.join(REPO, "cli", "src", "commands", "team", "start.js"),
      "utf-8",
    );
    // La pausa si fa solo dopo una voce che è davvero partita in questo giro,
    // e nasce da quella voce (settleBefore: sonda di prontezza, tetto = preDelayMs).
    expect(source).toContain("let previous = null");
    expect(source).toContain("if (previous?.started && item.preDelayMs && item.preDelayMs > 0) await settleBefore(previous, item)");
    expect(source).toContain("previous = { ...item, started: result === 'started' }");
    // Le voci saltate non partite non devono far aspettare la successiva.
    expect(source).toContain("previous = { ...item, started: false }");
  });

  it("lascia al preflight provider il tempo di completare uno start freddo", () => {
    const source = readFileSync(
      path.join(REPO, "cli", "src", "commands", "team", "start.js"),
      "utf-8",
    );
    expect(source).toContain("timeoutMs: 90_000");
  });

  it("il pid1 termina pulitamente entro la grace period del runtime", () => {
    const source = readFileSync(
      path.join(REPO, "cli", "src", "commands", "pid1.js"),
      "utf-8",
    );
    expect(source).toContain("clearInterval(keepAlive)");
    expect(source).toContain("pid1Log('shutdown complete')");
    expect(source).toContain("process.exit(0)");
  });
});
