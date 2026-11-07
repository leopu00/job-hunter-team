/**
 * `jht providers limits --json` — quanto resta delle finestre 5h e
 * settimanale, letto una volta prima di accendere il team.
 *
 * Il desktop lo chiede prima dell'avvio: con un limite esaurito dice quando si
 * libera invece di partire e fermarsi a metà; senza dato parte con l'avviso
 * «limiti non verificati». Qui il CLI VERO: con un python3 finto che fa da
 * `sentinel-bridge.py --probe-limits` si controlla che passino solo stato,
 * orario e percentuali (mai un token) e che ogni guasto diventi "unknown"; con
 * il bridge vero e nessun dato, che il risultato sia "unknown" e non un errore.
 * Questo caso resta offline: PATH privato con il solo Python reale, home e
 * cache private, nessuna CLI dei provider disponibile.
 * Su Windows si salta: il comando gira nel container Linux.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");
const SECRET = "sk-ant-oat01-fixture-secret-token";
const UNKNOWN = { status: "unknown", resets_at: null, five_hour: null, weekly: null };

const posixOnly = process.platform === "win32" ? describe.skip : describe;

function sandbox(fakePython?: string) {
  const root = mkdtempSync(path.join(tmpdir(), "jht-provider-limits-"));
  const home = path.join(root, "jht");
  mkdirSync(home);
  writeFileSync(path.join(home, "jht.config.json"), JSON.stringify({ active_provider: "codex" }));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const python = path.join(bin, "python3");
  if (fakePython !== undefined) {
    writeFileSync(python, `#!/bin/sh\n${fakePython}\n`, "utf-8");
    chmodSync(python, 0o755);
  } else {
    // Resolve only the interpreter, before removing all provider tools from PATH.
    const executable = JSON.parse(execFileSync("python3", [
      "-I", "-S", "-c", "import json, os, sys; print(json.dumps(os.path.realpath(sys.executable)))",
    ], { encoding: "utf-8", timeout: 60_000 }));
    if (typeof executable !== "string" || !path.isAbsolute(executable)) throw new Error("A real Python interpreter is required.");
    symlinkSync(executable, python);
  }
  return { HOME: root, JHT_HOME: home, CODEX_HOME: path.join(home, ".codex"), PATH: bin,
    PYTHONPATH: "", PYTHONHOME: "", PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1" };
}

function limits(env: Record<string, string>) {
  const r = spawnSync(process.execPath, [JHT_BIN, "providers", "limits", "--json"], {
    encoding: "utf-8",
    env: { ...process.env, ...env, JHT_CONTAINER: "1", NO_COLOR: "1" },
    timeout: 60_000,
  });
  expect(r.status, r.stderr).toBe(0);
  return { parsed: JSON.parse(r.stdout.trim()), stdout: r.stdout };
}

posixOnly("jht providers limits --json", () => {
  it("passes an exhausted verdict with its reset time and nothing else", () => {
    const verdict = {
      status: "exhausted",
      resets_at: 1_900_000_000,
      five_hour: { used_pct: 97, resets_at: 1_900_000_000 },
      weekly: { used_pct: 40, resets_at: 1_900_500_000 },
      token: SECRET,
    };
    const { parsed, stdout } = limits(sandbox(`printf '%s' '${JSON.stringify(verdict)}'`));
    expect(parsed).toEqual({
      status: "exhausted",
      resets_at: 1_900_000_000,
      five_hour: { used_pct: 97, resets_at: 1_900_000_000 },
      weekly: { used_pct: 40, resets_at: 1_900_500_000 },
    });
    expect(stdout).not.toContain(SECRET);
  });

  it("passes an ok verdict without a reset time", () => {
    const verdict = {
      status: "ok",
      resets_at: 123,
      five_hour: { used_pct: 12, resets_at: 1_900_000_000 },
      weekly: null,
    };
    const { parsed } = limits(sandbox(`printf '%s' '${JSON.stringify(verdict)}'`));
    expect(parsed).toEqual({
      status: "ok",
      resets_at: null,
      five_hour: { used_pct: 12, resets_at: 1_900_000_000 },
      weekly: null,
    });
  });

  it("passes an ok verdict of a single-weekly-window plan without inventing a 5h window", () => {
    const verdict = {
      status: "ok",
      resets_at: null,
      five_hour: null,
      weekly: { used_pct: 14, resets_at: 1_900_500_000 },
    };
    const { parsed } = limits(sandbox(`printf '%s' '${JSON.stringify(verdict)}'`));
    expect(parsed).toEqual(verdict);
  });

  it.each([
    ["the probe fails", `echo "Traceback: token ${SECRET}" >&2; exit 1`],
    ["the probe prints garbage", `echo "not json ${SECRET}"`],
    ["the status is not one of ours", `printf '%s' '{"status":"maybe"}'`],
    ["exhausted comes without a reset time", `printf '%s' '{"status":"exhausted","resets_at":null}'`],
    ["ok comes without the 5h window", `printf '%s' '{"status":"ok","resets_at":null,"five_hour":null}'`],
  ])("reads as unknown when %s", (_label, body) => {
    const { parsed, stdout } = limits(sandbox(body));
    expect(parsed).toEqual(UNKNOWN);
    expect(stdout).not.toContain(SECRET);
  });

  it("reads the real bridge and, with no provider data, answers unknown", () => {
    const env = sandbox();
    // Check the real interpreter's view without invoking any provider executable.
    const probe = spawnSync(path.join(env.PATH, "python3"), ["-I", "-S", "-c", [
      "import json, os, shutil",
      "print(json.dumps({'tools': {name: shutil.which(name) for name in ('codex', 'claude', 'kimi')},",
      "'home': os.environ['HOME'], 'scope': os.environ['JHT_HOME'], 'codex_home': os.environ['CODEX_HOME'],",
      "'cache': os.path.exists(os.environ['CODEX_HOME'])}))",
    ].join("\n")], { encoding: "utf-8", env: { ...process.env, ...env }, timeout: 60_000 });
    expect(probe.status, probe.stderr).toBe(0);
    expect(JSON.parse(probe.stdout)).toEqual({ tools: { codex: null, claude: null, kimi: null },
      home: env.HOME, scope: env.JHT_HOME, codex_home: env.CODEX_HOME, cache: false });
    const config = path.join(env.JHT_HOME, "jht.config.json");
    const before = readFileSync(config, "utf-8");
    const { parsed } = limits(env);
    expect(parsed).toEqual(UNKNOWN);
    expect(readFileSync(config, "utf-8")).toBe(before);
    expect(existsSync(env.CODEX_HOME)).toBe(false);
  });
});
