/**
 * [PROVIDER-MODEL-PIN] — addendum a [PROVIDER-CLI-AUTOUPDATE]: aggiornare la
 * CLI non sposta il modello, perché la CLI si scrive un pin al primo login e
 * non lo rivede mai più. Al boot quel pin viene rilevato, VERIFICATO e — solo
 * se la verifica è conclusiva — invalidato.
 *
 * Il test che conta davvero è il rovescio di quello ovvio: non "il pin vecchio
 * viene rimosso" ma **"quando non riesco a provare che il modello nuovo è
 * utilizzabile, il file NON viene toccato"**. Un pin vecchio costa contesto; un
 * pin cancellato male lascia la CLI senza modello e il team non parte affatto.
 *
 * Stessa sandbox del file gemello (provider-autoupdate.test.ts): CLI vero
 * lanciato in un PATH finto, JHT_HOME finta, e un `kimi` di comodo che imita
 * l'unica cosa che ci interessa osservare — cosa scrive (o non scrive) nel
 * config di prova che gli passiamo con `--config-file`.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");

const posixOnly = process.platform === "win32" ? describe.skip : describe;

/** Il pin come lo scrive kimi-cli al login, con intorno roba da preservare. */
const PINNED_CONFIG = `default_model = "kimi-code/kimi-for-coding"
default_thinking = true

[models."kimi-code/kimi-for-coding"]
  provider         = "managed:kimi-code"
  max_context_size = 262144
  display_name     = "K2.7 Coding"

[models."kimi-k2-thinking-turbo"]
  provider         = "managed:kimi-code"
  max_context_size = 262144

[loop_control]
max_steps_per_turn = 20
`;

/** Cosa la CLI risolve quando le si toglie il pin (nel config DI PROVA). */
const RESOLVED_NEW = `default_model = "kimi-code/kimi-for-k3"
default_thinking = true

[models."kimi-code/kimi-for-k3"]
  provider         = "managed:kimi-code"
  max_context_size = 1048576
  display_name     = "K3 Coding"

[loop_control]
max_steps_per_turn = 20
`;

type Probe = "new" | "same" | "silent" | "fail" | "hang" | "only-prompt";

type Sandbox = {
  root: string;
  home: string;
  bin: string;
  kimiConfig: string;
  config: () => string;
  backups: () => string[];
  calls: (name: string) => string[];
  mailbox: () => Record<string, unknown>[];
};

function writeExec(file: string, body: string) {
  writeFileSync(file, `#!/bin/sh\n${body}\n`, "utf-8");
  chmodSync(file, 0o755);
}

function makeSandbox(opts: {
  provider?: string;
  probe?: Probe;
  config?: string | null;
  credentials?: boolean;
  codexConfig?: string | null;
}): Sandbox {
  const provider = opts.provider ?? "kimi";
  const root = mkdtempSync(path.join(tmpdir(), "jht-model-pin-"));
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });

  // Esito del probe: cosa fa il finto `kimi` quando lo si invoca con
  // --config-file <copia>. È l'unica cosa che il codice osserva.
  const probe = opts.probe ?? "new";
  writeFileSync(path.join(root, "resolved.toml"), probe === "same" ? PINNED_CONFIG : RESOLVED_NEW, "utf-8");
  const onProbe =
    probe === "silent" ? "exit 0" :
    probe === "fail" ? 'echo "kimi: LLM not set" >&2\nexit 1' :
    probe === "hang" ? "sleep 60" :
    probe === "only-prompt"
      // `info` non risolve niente, il turno non-interattivo sì: verifica che la
      // ladder scenda al passo successivo invece di arrendersi al primo.
      ? `case "$*" in *--quiet*) cat "${root}/resolved.toml" > "$CFG"; exit 0 ;; esac\nexit 1`
      : `cat "${root}/resolved.toml" > "$CFG"\nexit 0`;

  writeExec(path.join(bin, "kimi"), [
    `echo "$*" >> "${root}/kimi.calls"`,
    'if [ "$1" = "--config-file" ]; then',
    '  CFG="$2"',
    `  ${onProbe.split("\n").join("\n  ")}`,
    "fi",
    `echo "kimi, version 1.42.0"`,
  ].join("\n"));
  writeExec(path.join(bin, "codex"), 'echo "codex-cli 0.145.0"');
  writeExec(path.join(bin, "claude"), 'echo "2.4.0 (Claude Code)"');
  for (const tool of ["npm", "sh"]) {
    writeExec(path.join(bin, tool), `echo "$*" >> "${root}/${tool}.calls"\nexit 0`);
  }

  const kimiDir = path.join(home, ".kimi");
  const kimiConfig = path.join(kimiDir, "config.toml");
  const cfgText = opts.config === undefined ? PINNED_CONFIG : opts.config;
  if (cfgText !== null) {
    mkdirSync(kimiDir, { recursive: true });
    writeFileSync(kimiConfig, cfgText, "utf-8");
  }
  if (opts.credentials !== false) {
    mkdirSync(path.join(kimiDir, "credentials"), { recursive: true });
    writeFileSync(path.join(kimiDir, "credentials", "kimi-code.json"), '{"access_token":"x"}', "utf-8");
  }
  if (opts.codexConfig) {
    mkdirSync(path.join(home, ".codex"), { recursive: true });
    writeFileSync(path.join(home, ".codex", "config.toml"), opts.codexConfig, "utf-8");
  }

  writeFileSync(
    path.join(home, "jht.config.json"),
    JSON.stringify({ active_provider: provider, providers: { [provider]: { auth_method: "subscription" } } }),
    "utf-8",
  );

  return {
    root, home, bin, kimiConfig,
    config: () => (existsSync(kimiConfig) ? readFileSync(kimiConfig, "utf-8") : ""),
    backups: () => {
      if (!existsSync(kimiDir)) return [];
      return readdirSync(kimiDir).filter((f) => f.includes(".bak-model-pin-"));
    },
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

/** Le invocazioni di probe (quelle con --config-file), non i `--version`. */
const probeCalls = (sb: Sandbox) => sb.calls("kimi").filter((c) => c.includes("--config-file"));

posixOnly("model pin — invalidazione VERIFICATA", () => {
  it("pin stale + verifica conclusiva: default_model e capability rimossi, il resto del config resta", () => {
    const sb = makeSandbox({ probe: "new" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);

    const after = sb.config();
    // Il pin se n'è andato… (la riga di assegnazione, non la parola: il file
    // resta con un commento che spiega cosa è stato tolto e perché)
    expect(after).not.toMatch(/^\s*default_model\s*=/m);
    expect(after).not.toContain('[models."kimi-code/kimi-for-coding"]');
    expect(after).not.toContain("262144\n  display_name");
    // …ma tutto il resto è ancora lì: max_steps_per_turn è stato calibrato a
    // mano (postmortem betaB 2026-06-24) e gli altri [models.*] sono roba
    // dell'utente. Un round-trip di un parser TOML li avrebbe mangiati.
    expect(after).toContain("[loop_control]");
    expect(after).toContain("max_steps_per_turn = 20");
    expect(after).toContain('[models."kimi-k2-thinking-turbo"]');
    expect(after).toContain("default_thinking = true");
    // E resta scritto nel file perché è stato toccato.
    expect(after).toContain("[PROVIDER-MODEL-PIN]");
  });

  it("scrive un backup identico all'originale prima di riscrivere", () => {
    const sb = makeSandbox({ probe: "new" });
    runAutoUpdate(sb);
    const backups = sb.backups();
    expect(backups).toHaveLength(1);
    const restored = readFileSync(path.join(sb.home, ".kimi", backups[0]), "utf-8");
    expect(restored).toBe(PINNED_CONFIG);
  });

  it("il finding al Capitano porta vecchio e nuovo modello, le due finestre e come tornare indietro", () => {
    const sb = makeSandbox({ probe: "new" });
    runAutoUpdate(sb);
    const inbox = sb.mailbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe("provider-cli");
    const msg = String(inbox[0].msg);
    expect(msg).toContain("kimi-code/kimi-for-coding");
    expect(msg).toContain("kimi-code/kimi-for-k3");
    expect(msg).toContain("262144");
    expect(msg).toContain("1048576");
    expect(msg).toContain("Backup:");
    expect(msg).toContain(".bak-model-pin-");
    // Il canale è la mailbox, non tmux: al boot la sessione CAPITANO non esiste.
    expect(inbox[0].delivered_via_tmux).toBe(false);
  });

  it("la ladder scende al turno non-interattivo se `info` non risolve niente", () => {
    const sb = makeSandbox({ probe: "only-prompt" });
    runAutoUpdate(sb);
    const calls = probeCalls(sb);
    expect(calls.some((c) => c.endsWith(" info"))).toBe(true);
    expect(calls.some((c) => c.includes("--quiet -p ok"))).toBe(true);
    expect(sb.config()).not.toMatch(/^\s*default_model\s*=/m);
  });

  it("il probe gira su una COPIA: il config vero non viene toccato dalla verifica", () => {
    // `same` = la CLI risolve esattamente il pin già presente → nessuna
    // modifica, nessun rumore al Capitano.
    const sb = makeSandbox({ probe: "same" });
    const r = runAutoUpdate(sb);
    expect(r.out).toContain("GIA' CORRENTE");
    expect(sb.config()).toBe(PINNED_CONFIG);
    expect(sb.backups()).toHaveLength(0);
    expect(sb.mailbox()).toHaveLength(0);
    // …e la copia passata al probe non era il file vero.
    expect(probeCalls(sb).join("\n")).not.toContain(sb.kimiConfig);
  });
});

posixOnly("model pin — quando la verifica NON è conclusiva non si tocca niente", () => {
  it("CLI che fallisce: config intatto, boot che prosegue, finding di sola segnalazione", () => {
    const sb = makeSandbox({ probe: "fail" });
    const r = runAutoUpdate(sb);
    // La regola più importante del ticket: il boot non si ferma.
    expect(r.code).toBe(0);
    expect(r.out).toContain("INCONCLUSIVA");
    expect(sb.config()).toBe(PINNED_CONFIG);
    expect(sb.backups()).toHaveLength(0);

    const msg = String(sb.mailbox()[0].msg);
    expect(msg).toContain("NON toccato");
    expect(msg).toContain("kimi-code/kimi-for-coding");
    expect(msg).toContain("meglio di un team fermo");
  });

  it("CLI che non riscrive il config di prova: nessuna modifica al file vero", () => {
    const sb = makeSandbox({ probe: "silent" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("INCONCLUSIVA");
    expect(sb.config()).toBe(PINNED_CONFIG);
    expect(sb.mailbox()).toHaveLength(1);
  });

  it("CLI che si pianta: il probe viene ucciso e il pin resta com'è", () => {
    const sb = makeSandbox({ probe: "hang" });
    const started = Date.now();
    const r = runAutoUpdate(sb, { JHT_MODEL_PIN_PROBE_TIMEOUT_SEC: "1" });
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(sb.config()).toBe(PINNED_CONFIG);
    expect(sb.backups()).toHaveLength(0);
  });

  it("senza credenziali non prova nemmeno: verificare sarebbe impossibile", () => {
    const sb = makeSandbox({ probe: "new", credentials: false });
    const r = runAutoUpdate(sb);
    expect(r.out).toContain("credenziali assenti");
    expect(probeCalls(sb)).toHaveLength(0);
    expect(sb.config()).toBe(PINNED_CONFIG);
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("stessa situazione a ogni riavvio: il finding non si ripete", () => {
    const sb = makeSandbox({ probe: "fail" });
    runAutoUpdate(sb);
    runAutoUpdate(sb);
    runAutoUpdate(sb);
    expect(sb.mailbox()).toHaveLength(1);
    expect(sb.config()).toBe(PINNED_CONFIG);
  });

  it("se la CLI ri-pinna lo stesso valore, non si riscrive il config a ogni boot", () => {
    const sb = makeSandbox({ probe: "new" });
    runAutoUpdate(sb);
    expect(sb.backups()).toHaveLength(1);
    // La CLI rimette esattamente il pin di prima: il meccanismo non funziona su
    // questa versione. Si smette di riprovare invece di riscrivere all'infinito.
    writeFileSync(sb.kimiConfig, PINNED_CONFIG, "utf-8");
    const second = runAutoUpdate(sb);
    expect(second.out).toContain("non riprovo");
    expect(sb.backups()).toHaveLength(1);
    expect(sb.config()).toBe(PINNED_CONFIG);
    expect(sb.mailbox()).toHaveLength(1);
  });
});

posixOnly("model pin — chi lo ferma, e i provider che non si toccano", () => {
  it("JHT_MODEL_PIN: il modello è fissato dall'utente, non si verifica e non si tocca", () => {
    const sb = makeSandbox({ probe: "new" });
    const r = runAutoUpdate(sb, { JHT_MODEL_PIN: "kimi-code/kimi-for-coding" });
    expect(r.out).toContain("fissato dall'utente");
    expect(probeCalls(sb)).toHaveLength(0);
    expect(sb.config()).toBe(PINNED_CONFIG);
    // Scelta esplicita dell'utente: non è una scoperta da riportare.
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("JHT_PROVIDER_AUTOUPDATE=0 ferma anche questo passo (boot invariato)", () => {
    const sb = makeSandbox({ probe: "new" });
    const r = runAutoUpdate(sb, { JHT_PROVIDER_AUTOUPDATE: "0" });
    expect(r.code).toBe(0);
    expect(probeCalls(sb)).toHaveLength(0);
    expect(sb.calls("sh")).toHaveLength(0);
    expect(sb.config()).toBe(PINNED_CONFIG);
  });

  it("fuori dal container non tocca il config del provider (è dell'utente del container)", () => {
    const sb = makeSandbox({ probe: "new" });
    const r = runAutoUpdate(sb, { IS_CONTAINER: "0" });
    expect(r.out).toContain("fuori dal container");
    expect(probeCalls(sb)).toHaveLength(0);
    expect(sb.config()).toBe(PINNED_CONFIG);
  });

  it("nessun config del provider: niente da rivedere, nessun rumore", () => {
    const sb = makeSandbox({ probe: "new", config: null });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("nessun config");
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("config senza pin: la CLI usa già il default corrente", () => {
    const sb = makeSandbox({ probe: "new", config: "[loop_control]\nmax_steps_per_turn = 20\n" });
    const r = runAutoUpdate(sb);
    expect(r.out).toContain("nessun pin");
    expect(probeCalls(sb)).toHaveLength(0);
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("codex: il pin viene SEGNALATO ma il file non si tocca (contiene anche i trust_level)", () => {
    const codex = `model = "gpt-5.4"\nmodel_reasoning_effort = "high"\n\n[projects."/jht_home/agents/capitano"]\ntrust_level = "trusted"\n`;
    const sb = makeSandbox({ provider: "openai", codexConfig: codex });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("NON modificabile");
    expect(readFileSync(path.join(sb.home, ".codex", "config.toml"), "utf-8")).toBe(codex);

    const msg = String(sb.mailbox()[0].msg);
    expect(msg).toContain("gpt-5.4");
    expect(msg).toContain("decisione dell'utente");
  });

  it("claude: nessun pin da invalidare, start-agent.sh passa --model a ogni spawn", () => {
    const sb = makeSandbox({ provider: "claude" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("non applicabile");
    expect(sb.mailbox()).toHaveLength(0);
  });
});
