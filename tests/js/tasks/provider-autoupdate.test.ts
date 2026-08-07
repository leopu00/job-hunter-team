/**
 * [PROVIDER-CLI-AUTOUPDATE] — la CLI del provider attivo si aggiorna da sola
 * al boot del container, e un aggiornamento non riuscito non ferma il boot.
 *
 * I test lanciano il CLI VERO (`node cli/bin/jht.js providers autoupdate`) in
 * una sandbox: PATH finto con `claude`/`kimi`/`npm`/`sh` di comodo, JHT_HOME
 * finta con il suo jht.config.json. Così si osserva il comportamento reale —
 * chi viene invocato, cosa finisce nel log, cosa arriva al Capitano — invece
 * di asseriree sul sorgente. Unica eccezione: l'ORDINE dentro pid1 (criterio 1),
 * che è una proprietà del boot e si verifica solo leggendo il dispatcher.
 *
 * Gli eseguibili finti sono script POSIX: su Windows la sandbox non regge e i
 * test si saltano (il container è Linux, è lì che il comportamento conta).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");
const PID1_SRC = readFileSync(path.join(REPO, "cli", "src", "commands", "pid1.js"), "utf-8");

const posixOnly = process.platform === "win32" ? describe.skip : describe;

type Sandbox = {
  root: string;
  home: string;
  bin: string;
  /** Versione che il finto binario del provider dichiara a `--version`. */
  setVersion: (v: string) => void;
  /** Argomenti con cui ogni finto eseguibile è stato invocato. */
  calls: (name: string) => string[];
  mailbox: () => Record<string, unknown>[];
};

function writeExec(file: string, body: string) {
  writeFileSync(file, `#!/bin/sh\n${body}\n`, "utf-8");
  chmodSync(file, 0o755);
}

/**
 * Sandbox con:
 *   bin/<provider>  → stampa la versione corrente (letta da ver)
 *   bin/npm, bin/sh → registrano l'invocazione e si comportano come chiesto
 *   home/jht.config.json → provider attivo
 */
function makeSandbox(opts: {
  provider: string;
  model?: string | null;
  version?: string;
  /** Esito degli step: 'ok', 'bump' (cambia versione), 'fail', 'hang' (non torna mai). */
  update?: "ok" | "bump" | "fail" | "hang";
  newVersion?: string;
  /** Versione esposta dal registry npm; per default segue l'esito atteso. */
  publishedVersion?: string;
}): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), "jht-autoupdate-"));
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(root, "ver"), opts.version ?? "1.0.0", "utf-8");

  const binName = opts.provider === "kimi" ? "kimi" : opts.provider === "openai" ? "codex" : "claude";
  writeExec(path.join(bin, binName), `echo "${binName} version $(cat "${root}/ver")"`);

  const outcome = opts.update ?? "ok";
  const effect =
    outcome === "bump" ? `echo "${opts.newVersion ?? "9.9.9"}" > "${root}/ver"\nexit 0` :
    outcome === "ok" ? "exit 0" :
    outcome === "hang" ? "sleep 60" :
    'echo "npm error code ENOTFOUND registry.npmjs.org" >&2\nexit 1';
  const published = opts.publishedVersion
    ?? (outcome === "bump" ? (opts.newVersion ?? "9.9.9")
      : outcome === "ok" ? (opts.version ?? "1.0.0")
        : "9.9.9");
  writeExec(path.join(bin, "npm"), [
    `echo "$*" >> "${root}/npm.calls"`,
    'if [ "$1" = "view" ]; then',
    `  echo "${published}"`,
    '  exit 0',
    'fi',
    effect,
  ].join("\n"));
  writeExec(path.join(bin, "sh"), `echo "$*" >> "${root}/sh.calls"\n${effect}`);

  const providers: Record<string, unknown> = { [opts.provider]: { auth_method: "subscription" } };
  if (opts.model) (providers[opts.provider] as Record<string, unknown>).model = opts.model;
  writeFileSync(
    path.join(home, "jht.config.json"),
    JSON.stringify({ active_provider: opts.provider, providers }),
    "utf-8",
  );

  return {
    root,
    home,
    bin,
    setVersion: (v) => writeFileSync(path.join(root, "ver"), v, "utf-8"),
    calls: (name) => {
      const f = path.join(root, `${name}.calls`);
      if (!existsSync(f)) return [];
      return readFileSync(f, "utf-8").split("\n").filter(Boolean);
    },
    mailbox: () => {
      const f = path.join(home, "logs", "bridge-mailbox.jsonl");
      if (!existsSync(f)) return [];
      return readFileSync(f, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    },
  };
}

function runAutoUpdate(sb: Sandbox, extraEnv: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [JHT_BIN, "providers", "autoupdate"], {
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

posixOnly("jht providers autoupdate — aggiornamento al boot", () => {
  it("aggiorna e logga la versione prima → dopo (criterio 2)", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "bump", newVersion: "2.4.0" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("2.1.220 → 2.4.0");
    expect(r.out).toContain("AGGIORNATA");
  });

  it("dice ESPLICITAMENTE quando la versione non è cambiata (criterio 2 + 7)", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.4.0", update: "ok" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("2.4.0 → 2.4.0");
    expect(r.out).toContain("INVARIATA");
    expect(r.out).toContain("era gia' all'ultima versione");
    expect(r.out).toContain("installazione saltata");
    expect(sb.calls("npm").some((c) => c.startsWith("install "))).toBe(false);
    // Nessun rumore al Capitano quando non è successo niente.
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("update fallito: exit 0, errore loggato, si prosegue con la CLI presente (criterio 3)", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "fail" });
    const r = runAutoUpdate(sb);
    // Il boot NON si ferma: è la regola più importante del ticket.
    expect(r.code).toBe(0);
    expect(r.out).toContain("ENOTFOUND");
    expect(r.out).toContain("step fallito");
    expect(r.out).toContain("2.1.220 → 2.1.220");
    expect(r.out).toContain("update NON riuscito");
    expect(r.out).toContain("il team parte con la CLI gia' presente");
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("registry che accetta e poi tace: lo step viene ucciso e il boot prosegue (criterio 3)", () => {
    // È la garanzia che regge la scelta SEQUENZIALE in pid1: senza un tetto
    // duro, npm senza timeout globale terrebbe in ostaggio il container intero.
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "hang" });
    const started = Date.now();
    const r = runAutoUpdate(sb, { JHT_PROVIDER_UPDATE_TIMEOUT_SEC: "1" });
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(r.out).toContain("update NON riuscito");
    expect(r.out).toContain("2.1.220 → 2.1.220");
  });

  it("provider attivo kimi: tocca SOLO i pacchetti di kimi, mai npm (criterio 4)", () => {
    const sb = makeSandbox({ provider: "kimi", version: "1.36.0", update: "bump", newVersion: "1.42.0" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(sb.calls("npm")).toHaveLength(0);
    const shCalls = sb.calls("sh").join("\n");
    expect(shCalls).toContain("uv tool install --force --python 3.13 kimi-cli");
    expect(shCalls).not.toContain("@anthropic-ai/claude-code");
    expect(shCalls).not.toContain("@openai/codex");
  });

  it("provider attivo claude: non tocca kimi né codex (criterio 4)", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "ok" });
    runAutoUpdate(sb);
    const npmCalls = sb.calls("npm").join("\n");
    expect(npmCalls).toContain("@anthropic-ai/claude-code@latest");
    expect(npmCalls).not.toContain("@openai/codex");
    expect(npmCalls).not.toContain("install -g");
    expect(sb.calls("sh")).toHaveLength(0);
  });

  it("il modello non viene toccato: la CLI nuova diventa un FINDING per il Capitano (criterio 5)", () => {
    const sb = makeSandbox({
      provider: "kimi", model: "kimi-k2-0905-preview",
      version: "1.36.0", update: "bump", newVersion: "1.42.0",
    });
    runAutoUpdate(sb);

    // Il finding passa dalla mailbox che il Capitano svuota a ogni turno
    // (skill bridge-mailbox): al boot la sessione CAPITANO non esiste ancora,
    // quindi un tmux-send andrebbe perso.
    const inbox = sb.mailbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe("provider-cli");
    const msg = String(inbox[0].msg);
    expect(msg).toContain("FINDING");
    expect(msg).toContain("1.36.0 → 1.42.0");
    expect(msg).toContain("kimi-k2-0905-preview");
    expect(msg).toContain("MODELLO NON e' stato cambiato");

    // E il modello nel config è rimasto quello di prima.
    const cfg = JSON.parse(readFileSync(path.join(sb.home, "jht.config.json"), "utf-8"));
    expect(cfg.providers.kimi.model).toBe("kimi-k2-0905-preview");
    expect(cfg.active_provider).toBe("kimi");
  });

  it("JHT_PROVIDER_AUTOUPDATE=0: nessun tentativo di update (criterio 6)", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "bump" });
    const r = runAutoUpdate(sb, { JHT_PROVIDER_AUTOUPDATE: "0" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("disabilitato");
    expect(sb.calls("npm")).toHaveLength(0);
    expect(sb.calls("sh")).toHaveLength(0);
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("secondo riavvio consecutivo: riconosce che è già aggiornata (criterio 7)", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "bump", newVersion: "2.4.0" });
    const first = runAutoUpdate(sb);
    expect(first.out).toContain("2.1.220 → 2.4.0");
    // Secondo boot: l'install è persistente (prefisso su volume), la versione
    // resta 2.4.0 e non c'è nessun finding nuovo da mandare al Capitano.
    const second = runAutoUpdate(sb);
    expect(second.out).toContain("2.4.0 → 2.4.0");
    expect(second.out).toContain("INVARIATA");
    expect(sb.mailbox()).toHaveLength(1);
  });

  it("senza active_provider non aggiorna niente", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "bump" });
    writeFileSync(path.join(sb.home, "jht.config.json"), JSON.stringify({}), "utf-8");
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("active_provider non ancora configurato");
    expect(sb.calls("npm")).toHaveLength(0);
  });

  it("config illeggibile: non esplode, non aggiorna, esce 0", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "bump" });
    writeFileSync(path.join(sb.home, "jht.config.json"), "{ non json", "utf-8");
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(sb.calls("npm")).toHaveLength(0);
  });

  it("fuori dal container non lancia niente (nessun docker compose a sorpresa)", () => {
    const sb = makeSandbox({ provider: "claude", version: "2.1.220", update: "bump" });
    const r = runAutoUpdate(sb, { IS_CONTAINER: "0" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("fuori dal container");
    expect(sb.calls("npm")).toHaveLength(0);
  });
});

/**
 * Criterio 1 — "la CLI risulta aggiornata PRIMA che parta il primo agente".
 * È un vincolo di ordine dentro il dispatcher di pid1: l'unico modo di
 * verificarlo senza avviare un container è leggere l'ordine delle chiamate.
 */
describe("pid1 — l'update precede tutto ciò che usa la CLI (criterio 1)", () => {
  const at = (needle: string) => PID1_SRC.indexOf(needle);

  it("chiama runProviderAutoUpdate nel dispatch", () => {
    expect(at("await runProviderAutoUpdate();")).toBeGreaterThan(-1);
  });

  it("l'update viene prima di bridge, watchdog e auto-start degli agenti", () => {
    const update = at("await runProviderAutoUpdate();");
    // Needle a forma di CHIAMATA, non di definizione: le funzioni sono
    // dichiarate a monte di dispatch() e matcherebbero comunque.
    for (const later of [
      "    startTgBridge();",
      "    startSentinelBridges();",
      "  startAgentWatchdog();",
      "  startDoctorWatchdog();",
      "startUserFacingAgents().catch(",
    ]) {
      const idx = PID1_SRC.indexOf(later, update);
      expect(idx, `${later} deve venire dopo l'auto-update`).toBeGreaterThan(update);
      // e non deve esistere un'occorrenza PRIMA dell'update
      expect(PID1_SRC.slice(0, update).includes(later), `${later} non deve girare prima dell'auto-update`).toBe(false);
    }
  });

  it("l'update è atteso (await): i bridge non partono mentre npm sostituisce il binario", () => {
    expect(PID1_SRC).toContain("await runProviderAutoUpdate();");
  });
});
