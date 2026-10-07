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
 * Su Windows si salta: il comando gira nel container Linux.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
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
  let PATH = process.env.PATH ?? "";
  if (fakePython !== undefined) {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const python = path.join(bin, "python3");
    writeFileSync(python, `#!/bin/sh\n${fakePython}\n`, "utf-8");
    chmodSync(python, 0o755);
    PATH = `${bin}${path.delimiter}${PATH}`;
  }
  return { HOME: root, JHT_HOME: home, PATH };
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
    const { parsed } = limits(sandbox());
    expect(parsed).toEqual(UNKNOWN);
  });
});
