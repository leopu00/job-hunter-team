/**
 * Issue #130 — la release dichiara e installa una versione Codex PRECISA.
 *
 * Perché esiste. Il setup v0.3.5 eseguiva `npm install -g @openai/codex@latest`:
 * un riferimento mutabile può cambiare il runtime del provider senza che cambi
 * niente nella release JHT. Conseguenze misurabili: un test riprodotto una
 * settimana dopo non è lo stesso test, il supporto non sa cosa gira sulla
 * macchina di chi segnala, e il rollback non ha un bersaglio.
 *
 * Cosa proteggono questi test, nell'ordine dei criteri di accettazione:
 *   1. il percorso di install non contiene più riferimenti mutabili;
 *   2. la versione attesa vive in un manifest versionato;
 *   3. setup e diagnostica mostrano attesa vs installata;
 *   4. l'aggiornamento è un atto esplicito (`--latest` lo dichiara a schermo,
 *      e resta temporaneo: il boot successivo riporta il pin);
 *   5. il grep del punto 1 è il guard contro la reintroduzione.
 *
 * Come per provider-autoupdate.test.ts si lancia il CLI VERO in una sandbox
 * POSIX (su Windows si salta: il container è Linux, è lì che conta).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");
const MANIFEST = path.join(REPO, "shared", "config", "provider-versions.json");
const PINS = JSON.parse(readFileSync(MANIFEST, "utf-8")).pins as Record<
  string,
  { kind: string; package: string; version: string; pinned_at: string; note: string }
>;

const posixOnly = process.platform === "win32" ? describe.skip : describe;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?$/;

function writeExec(file: string, body: string) {
  writeFileSync(file, `#!/bin/sh\n${body}\n`, "utf-8");
  chmodSync(file, 0o755);
}

/** Sandbox: PATH con provider/npm/sh finti, JHT_HOME con il provider attivo. */
function makeSandbox(opts: { provider: "claude" | "codex" | "kimi"; version: string }) {
  const root = mkdtempSync(path.join(tmpdir(), "jht-pin-"));
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });

  const binName = opts.provider === "kimi" ? "kimi" : opts.provider === "codex" ? "codex" : "claude";
  writeExec(path.join(bin, binName), `echo "${binName} version ${opts.version}"`);
  // Gli altri due non esistono: `versions` deve saperlo dire senza rompersi.
  writeExec(path.join(bin, "npm"), `echo "$*" >> "${root}/npm.calls"\nexit 0`);
  writeExec(path.join(bin, "sh"), `echo "$*" >> "${root}/sh.calls"\nexit 0`);

  const activeId = opts.provider === "codex" ? "openai" : opts.provider;
  writeFileSync(
    path.join(home, "jht.config.json"),
    JSON.stringify({ active_provider: activeId, providers: { [activeId]: { auth_method: "subscription" } } }),
    "utf-8",
  );
  return {
    root,
    home,
    bin,
    calls: (name: string) => {
      const f = path.join(root, `${name}.calls`);
      try { return readFileSync(f, "utf-8").split("\n").filter(Boolean); } catch { return []; }
    },
  };
}

function runCli(sb: ReturnType<typeof makeSandbox>, args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [JHT_BIN, ...args], {
    encoding: "utf-8",
    timeout: 60_000,
    env: {
      PATH: [sb.bin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
      HOME: sb.root,
      JHT_HOME: sb.home,
      IS_CONTAINER: "1",
      NPM_CONFIG_PREFIX: path.join(sb.root, "prefix"),
      ...extraEnv,
    },
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ── Criterio 2: la versione attesa vive in un manifest versionato ───────

describe("provider-versions.json — il manifest della release", () => {
  it("dichiara i tre provider con una versione precisa", () => {
    expect(Object.keys(PINS).sort()).toEqual(["claude", "codex", "kimi"]);
    for (const [name, pin] of Object.entries(PINS)) {
      expect(pin.package, `${name}: package`).toBeTruthy();
      expect(pin.version, `${name}: version`).toMatch(SEMVER);
      // Niente tag mutabili travestiti da versione.
      expect(pin.version).not.toBe("latest");
      // La traccia di release: quando è stato deciso e perché.
      expect(pin.pinned_at, `${name}: pinned_at`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(pin.note).length, `${name}: note`).toBeGreaterThan(20);
    }
  });

  it("dichiara come si installa ciascun pacchetto (npm o uv)", () => {
    expect(PINS.claude.kind).toBe("npm");
    expect(PINS.codex.kind).toBe("npm");
    // kimi arriva da PyPI via uv: un pin npm lo installerebbe da un pacchetto
    // omonimo e diverso (`kimi-cli` esiste su entrambi i registri).
    expect(PINS.kimi.kind).toBe("uv");
  });
});

// ── Criteri 1 e 5: nessun riferimento mutabile nel percorso di install ──

describe("il percorso di install non contiene riferimenti mutabili", () => {
  // I file che INSTALLANO davvero — CLI, launcher, script di setup e il
  // bottone "aggiorna provider" della dashboard, che è l'altro percorso di
  // installazione reale (locale) e passa dallo stesso manifest.
  const ROOTS = [
    "cli/src",
    "cli/wizard",
    "cli/bin",
    ".launcher",
    "scripts",
    "web/app/api/providers",
  ];
  const EXT = [".js", ".mjs", ".ts", ".sh", ".ps1"];
  const MUTABLE = /@openai\/codex@latest|@anthropic-ai\/claude-code@latest/;

  function walk(dir: string, out: string[] = []) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
      if (e === "node_modules" || e.startsWith(".git")) continue;
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (EXT.includes(path.extname(full))) out.push(full);
    }
    return out;
  }

  it("nessun @latest per i CLI provider (guard anti-reintroduzione)", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(path.join(REPO, root))) {
        const src = readFileSync(file, "utf-8");
        for (const [i, line] of src.split("\n").entries()) {
          if (MUTABLE.test(line)) offenders.push(`${path.relative(REPO, file)}:${i + 1}`);
        }
      }
    }
    expect(offenders, "install the pinned version from shared/config/provider-versions.json").toEqual([]);
  });

  it("il Dockerfile non installa CLI provider (restano lazy, e pinnati)", () => {
    const df = readFileSync(path.join(REPO, "Dockerfile"), "utf-8");
    expect(df).not.toMatch(/npm (install|i) -g .*(@openai\/codex|@anthropic-ai\/claude-code)/);
  });
});

// ── Criteri 3 e 4: diagnostica e aggiornamento esplicito ────────────────

posixOnly("jht providers versions / update — attesa vs installata", () => {
  it("dice attesa e installata, ed è verde quando coincidono", () => {
    const sb = makeSandbox({ provider: "codex", version: PINS.codex.version });
    const r = runCli(sb, ["providers", "versions"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(PINS.codex.version);
    expect(r.out).toContain("matches the release");
    expect(r.out).toContain("provider-versions.json");
  });

  it("segnala il DRIFT e esce 1 (gate scriptabile per un e2e)", () => {
    const sb = makeSandbox({ provider: "codex", version: "0.99.0" });
    const r = runCli(sb, ["providers", "versions"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("DRIFT");
    expect(r.out).toContain("0.99.0");
  });

  it("--json porta gli stessi fatti in forma leggibile da una macchina", () => {
    const sb = makeSandbox({ provider: "codex", version: PINS.codex.version });
    const r = runCli(sb, ["providers", "versions", "--json"]);
    const payload = JSON.parse(r.out.trim().split("\n").pop() as string);
    const codex = payload.providers.find((p: { provider: string }) => p.provider === "codex");
    expect(codex.expected).toBe(PINS.codex.version);
    expect(codex.installed).toBe(PINS.codex.version);
    expect(codex.state).toBe("ok");
    expect(payload.manifest).toContain("provider-versions.json");
  });

  it("un provider non installato non è un drift", () => {
    // Sandbox con solo `codex` sul PATH: claude e kimi non esistono.
    const sb = makeSandbox({ provider: "codex", version: PINS.codex.version });
    const r = runCli(sb, ["providers", "versions"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("not installed yet");
  });

  it("update installa la versione della release, non l'ultima pubblicata", () => {
    const sb = makeSandbox({ provider: "codex", version: "0.99.0" });
    const r = runCli(sb, ["providers", "update", "codex"]);
    expect(r.code).toBe(0);
    const calls = sb.calls("npm").join("\n");
    expect(calls).toContain(`install -g ${PINS.codex.package}@${PINS.codex.version}`);
    expect(calls).not.toContain("@latest");
    // E lo dice, con il file da cui viene la decisione.
    expect(r.out).toContain(`pinned version ${PINS.codex.version}`);
  });

  it("--latest è la deroga esplicita, e si dichiara a schermo", () => {
    const sb = makeSandbox({ provider: "codex", version: "0.99.0" });
    const r = runCli(sb, ["providers", "update", "codex", "--latest"]);
    expect(r.code).toBe(0);
    expect(sb.calls("npm").join("\n")).toContain(`install -g ${PINS.codex.package}@latest`);
    // Chi la usa deve sapere che è temporanea: il boot dopo torna al pin.
    expect(r.out).toContain("--latest");
    expect(r.out).toContain("release pin");
  });
});
