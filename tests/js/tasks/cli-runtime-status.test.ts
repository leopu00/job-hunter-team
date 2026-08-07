import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
  writeFileSync(
    path.join(home, "jht.config.json"),
    JSON.stringify({
      version: 4,
      active_provider: "openai",
      providers: { openai: { auth_method: "subscription" } },
    }),
    "utf-8",
  );
  writeExec(
    path.join(bin, "tmux"),
    [
      'case "$*" in',
      "  *list-sessions*) printf 'ASSISTENTE\\nCAPITANO\\nMENTOR\\nSENTINELLA\\nSCOUT-1\\nunrelated\\n' ;;",
      "  *) echo 'tmux 3.5' ;;",
      "esac",
    ].join("\n"),
  );
  writeExec(path.join(bin, "git"), "exit 1");
  return { root, home, bin };
}

function run(command: string) {
  const sb = sandbox();
  const r = spawnSync(process.execPath, [JHT_BIN, command], {
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
    expect(r.out).toContain("Sessioni tmux JHT: 5");
    expect(r.out).toContain("SCOUT-1");
    expect(r.out).not.toContain("    - unrelated");
  });

  it("jht doctor riconosce i quattro agenti core moderni", () => {
    const r = run("doctor");
    expect(r.code).toBe(0);
    for (const name of ["ASSISTENTE", "CAPITANO", "MENTOR", "SENTINELLA"]) {
      expect(r.out).toContain(`${name}: attivo`);
      expect(r.out).not.toContain(`${name}: non trovato`);
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
    expect(source).toContain(
      "Team gia operativo: nessun bridge o sync riavviato.",
    );
  });

  it("applica lo stagger solo quando la voce precedente è stata avviata", () => {
    const source = readFileSync(
      path.join(REPO, "cli", "src", "commands", "team", "start.js"),
      "utf-8",
    );
    expect(source).toContain("let previousStarted = false");
    expect(source).toContain("if (previousStarted && item.preDelayMs");
    expect(source).toContain("previousStarted = result === 'started'");
  });
});
