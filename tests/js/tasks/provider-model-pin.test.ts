/**
 * [PROVIDER-MODEL-PIN] — la CLI si pinna un modello al primo login e non lo
 * rivede mai più. Al boot il passo sceglie fra gli alias che il config **già
 * elenca**, prova il migliore e — solo se risponde — lo **scrive**.
 *
 * Il file riflette due lezioni pagate in produzione:
 *
 *   • cancellare `default_model` non serve a niente: la CLI lo riscrive
 *     puntando di nuovo al vecchio alias, che è il default del piano. Quindi si
 *     asserisce la **sostituzione**, non l'invalidazione;
 *   • il probe che interrogava una copia SENZA pin dava falso negativo — la CLI
 *     restava senza modello e usciva 1. Ora si chiede l'alias per nome
 *     (`--model`) su una copia intatta, e i test distinguono "l'alias non
 *     risponde" da "il probe non ha saputo chiedere".
 *
 * Il test che conta di più resta il rovescio di quello ovvio: quando il
 * candidato non risponde, il file **non** viene toccato. Un pin vecchio costa
 * contesto; un pin scritto male costa l'intero team.
 *
 * Stessa sandbox del file gemello (provider-autoupdate.test.ts): CLI vero in un
 * PATH finto, JHT_HOME finta, e un `kimi` di comodo che imita l'unica cosa che
 * il codice osserva — se l'alias richiesto risponde o no.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(__dirname, "../../..");
const JHT_BIN = path.join(REPO, "cli", "bin", "jht.js");

const posixOnly = process.platform === "win32" ? describe.skip : describe;

/**
 * Il config come si presenta sul campo: il pin del login, e sotto il catalogo
 * degli alias che l'account espone davvero — quattro, due generazioni, due
 * finestre. Più roba intorno che non deve sparire.
 */
const FIELD_CONFIG = `default_model = "kimi-code/kimi-for-coding"
default_thinking = true

[models."kimi-code/kimi-for-coding"]
  provider         = "managed:kimi-code"
  max_context_size = 262144
  display_name     = "K2.7 Coding"

[models."kimi-code/kimi-for-coding-highspeed"]
  provider         = "managed:kimi-code"
  max_context_size = 262144
  display_name     = "K2.7 Coding highspeed"

[models."kimi-code/k3-256k"]
  provider         = "managed:kimi-code"
  max_context_size = 262144
  display_name     = "K3 Coding 256k"

[models."kimi-code/k3"]
  provider         = "managed:kimi-code"
  max_context_size = 1048576
  display_name     = "K3 Coding"

[loop_control]
max_steps_per_turn = 20
`;

/** Come risponde il finto `kimi` quando gli si chiede un alias per nome. */
type Probe =
  | "answers"        // exit 0 + risposta: l'alias è utilizzabile
  | "refuses"        // exit 1: l'alias non è disponibile su questo piano
  | "silent"         // exit 0 ma nessun output: probe non concludente
  | "hang"           // non torna mai
  | "only-second";   // il migliore rifiuta, gli altri rispondono

type Sandbox = {
  root: string;
  home: string;
  bin: string;
  kimiConfig: string;
  config: () => string;
  backups: () => string[];
  calls: (name: string) => string[];
  probes: () => string[];
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

  const probe = opts.probe ?? "answers";
  // `To resume this session: …` è la firma che kimi stampa ANCHE sui successi:
  // il finto binario la emette sempre, così un test si accorgerebbe se qualcuno
  // tornasse a leggerla come indicatore d'errore.
  const resume = 'echo "To resume this session: kimi -r f5c7339d-0000" >&2';
  const refuse = `${resume}\necho "model not available on your plan" >&2\nexit 1`;
  const onProbe =
    probe === "refuses" ? refuse :
    probe === "silent" ? `${resume}\nexit 0` :
    probe === "hang" ? "sleep 60" :
    probe === "only-second"
      ? `case "$MODEL" in\n*/k3) ${refuse} ;;\nesac\n${resume}\necho ok\nexit 0`
      : `${resume}\necho ok\nexit 0`;

  writeExec(path.join(bin, "kimi"), [
    `echo "$*" >> "${root}/kimi.calls"`,
    "MODEL=''",
    'while [ $# -gt 0 ]; do',
    '  if [ "$1" = "--model" ]; then MODEL="$2"; fi',
    "  shift",
    "done",
    'if [ -n "$MODEL" ]; then',
    ...onProbe.split("\n").map((l) => `  ${l}`),
    "fi",
    'echo "kimi, version 1.42.0"',
  ].join("\n"));
  writeExec(path.join(bin, "codex"), 'echo "codex-cli 0.145.0"');
  writeExec(path.join(bin, "claude"), 'echo "2.4.0 (Claude Code)"');
  for (const tool of ["npm", "sh"]) {
    writeExec(path.join(bin, tool), `echo "$*" >> "${root}/${tool}.calls"\nexit 0`);
  }

  const kimiDir = path.join(home, ".kimi");
  const kimiConfig = path.join(kimiDir, "config.toml");
  const cfgText = opts.config === undefined ? FIELD_CONFIG : opts.config;
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

  const calls = (name: string) => {
    const f = path.join(root, `${name}.calls`);
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf-8").split("\n").filter(Boolean);
  };

  return {
    root, home, bin, kimiConfig, calls,
    config: () => (existsSync(kimiConfig) ? readFileSync(kimiConfig, "utf-8") : ""),
    backups: () => (existsSync(kimiDir) ? readdirSync(kimiDir).filter((f) => f.includes(".bak-model-pin-")) : []),
    probes: () => calls("kimi").filter((c) => c.includes("--model")),
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

const defaultModelOf = (cfg: string) => /^\s*default_model\s*=\s*"(.+?)"/m.exec(cfg)?.[1] ?? null;

posixOnly("model pin — il modello si SOSTITUISCE, non si cancella", () => {
  it("promuove l'alias con la finestra più ampia fra quelli che il config elenca", () => {
    const sb = makeSandbox({ probe: "answers" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    // k3 (1048576) batte k3-256k / kimi-for-coding / -highspeed (262144 tutti).
    // Il criterio è la finestra dichiarata, non il nome.
    expect(defaultModelOf(sb.config())).toBe("kimi-code/k3");
    expect(r.out).toContain("PROMOTED");
  });

  it("il catalogo resta intatto: si riscrive UNA riga, non si cancella niente", () => {
    const sb = makeSandbox({ probe: "answers" });
    runAutoUpdate(sb);
    const after = sb.config();
    // Tutti e quattro gli alias sono ancora dichiarati — sono la risposta
    // dell'account su cosa è disponibile, non roba nostra da potare.
    for (const alias of [
      "kimi-code/kimi-for-coding",
      "kimi-code/kimi-for-coding-highspeed",
      "kimi-code/k3-256k",
      "kimi-code/k3",
    ]) expect(after).toContain(`[models."${alias}"]`);
    // E il resto del file pure: max_steps_per_turn è stato calibrato a mano
    // (postmortem betaB 2026-06-24). Un round-trip TOML l'avrebbe mangiato.
    expect(after).toContain("[loop_control]");
    expect(after).toContain("max_steps_per_turn = 20");
    expect(after).toContain("default_thinking = true");
    // Una sola riga default_model, non due.
    expect(after.match(/^\s*default_model\s*=/gm)).toHaveLength(1);
  });

  it("prova l'alias PER NOME su una copia intatta: è la correzione del falso negativo", () => {
    const sb = makeSandbox({ probe: "answers" });
    runAutoUpdate(sb);
    const probes = sb.probes();
    expect(probes).toHaveLength(1);
    // La copia porta con sé il config completo e l'alias si sceglie con
    // --model: la CLI non resta mai senza modello, che era la causa dell'exit 1.
    expect(probes[0]).toContain("--model kimi-code/k3");
    expect(probes[0]).toContain("--quiet -p rispondi solo: ok");
    expect(probes[0]).toContain("--config-file");
    expect(probes[0]).not.toContain(sb.kimiConfig);
  });

  it("scrive un backup identico all'originale prima di riscrivere", () => {
    const sb = makeSandbox({ probe: "answers" });
    runAutoUpdate(sb);
    const backups = sb.backups();
    expect(backups).toHaveLength(1);
    expect(readFileSync(path.join(sb.home, ".kimi", backups[0]), "utf-8")).toBe(FIELD_CONFIG);
  });

  it("il finding porta i due modelli, le due finestre, il ripristino e il riavvio sessioni", () => {
    const sb = makeSandbox({ probe: "answers" });
    runAutoUpdate(sb);
    const inbox = sb.mailbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe("provider-cli");
    const msg = String(inbox[0].msg);
    expect(msg).toContain("kimi-code/kimi-for-coding");
    expect(msg).toContain("kimi-code/k3");
    expect(msg).toContain("262144");
    expect(msg).toContain("1048576");
    expect(msg).toContain(".bak-model-pin-");
    // Senza questa riga chi lancia il comando a mano crede che non abbia
    // funzionato: gli agenti leggono il modello all'avvio della sessione.
    expect(msg).toContain("session STARTS");
    expect(inbox[0].delivered_via_tmux).toBe(false);
  });

  it("config lasciato senza default_model (la vecchia invalidazione): lo riscrive", () => {
    const sb = makeSandbox({ probe: "answers", config: FIELD_CONFIG.replace(/^default_model.*\n/m, "") });
    runAutoUpdate(sb);
    expect(defaultModelOf(sb.config())).toBe("kimi-code/k3");
  });

  it("se la CLI rimette il default del piano, il boot dopo lo ri-promuove senza ripetere il finding", () => {
    const sb = makeSandbox({ probe: "answers" });
    runAutoUpdate(sb);
    expect(defaultModelOf(sb.config())).toBe("kimi-code/k3");
    // Login successivo: la CLI ha ripristinato il suo default.
    writeFileSync(sb.kimiConfig, FIELD_CONFIG, "utf-8");
    runAutoUpdate(sb);
    expect(defaultModelOf(sb.config())).toBe("kimi-code/k3");
    // Riaffermare la scelta è la cura; ripetere il finding sarebbe rumore.
    expect(sb.mailbox()).toHaveLength(1);
  });

  it("non accumula note nostre né backup a ogni giro", () => {
    const sb = makeSandbox({ probe: "answers" });
    for (let i = 0; i < 5; i++) {
      writeFileSync(sb.kimiConfig, FIELD_CONFIG, "utf-8");
      runAutoUpdate(sb);
    }
    expect(sb.config().match(/PROVIDER-MODEL-PIN/g)).toHaveLength(1);
    expect(sb.backups().length).toBeLessThanOrEqual(3);
  });
});

posixOnly("model pin — se il candidato non risponde, il file non si tocca", () => {
  it("alias rifiutato dal piano: config intatto, boot che prosegue, finding col motivo", () => {
    const sb = makeSandbox({ probe: "refuses" });
    const r = runAutoUpdate(sb);
    // La regola più importante del ticket: il boot non si ferma.
    expect(r.code).toBe(0);
    expect(sb.config()).toBe(FIELD_CONFIG);
    expect(sb.backups()).toHaveLength(0);

    const msg = String(sb.mailbox()[0].msg);
    expect(msg).toContain("NOT promoted");
    expect(msg).toContain("did not respond");
    expect(msg).toContain("far better than a stopped team");
  });

  it("un candidato bocciato non ferma la lista: si passa al successivo", () => {
    const sb = makeSandbox({ probe: "only-second" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    // Con k3 (1M) bocciato restano solo alias a 262144, cioè NON migliori
    // dell'attuale: non c'è un secondo candidato legittimo e non si scrive.
    // Promuovere "il primo che risponde" avrebbe cambiato modello per niente.
    expect(sb.probes()).toHaveLength(1);
    expect(sb.probes()[0]).toContain("--model kimi-code/k3");
    expect(sb.config()).toBe(FIELD_CONFIG);
  });

  it("più candidati migliori: se il primo rifiuta si prova il secondo e si promuove quello", () => {
    // Due finestre più ampie dell'attuale: k3 (1M, rifiutato) e k3-mid (512k).
    const twoBetter = FIELD_CONFIG.replace(
      '[models."kimi-code/k3-256k"]\n  provider         = "managed:kimi-code"\n  max_context_size = 262144',
      '[models."kimi-code/k3-mid"]\n  provider         = "managed:kimi-code"\n  max_context_size = 524288',
    );
    const sb = makeSandbox({ probe: "only-second", config: twoBetter });
    runAutoUpdate(sb);
    const probes = sb.probes();
    expect(probes).toHaveLength(2);
    expect(probes[0]).toContain("--model kimi-code/k3");
    expect(probes[1]).toContain("--model kimi-code/k3-mid");
    expect(defaultModelOf(sb.config())).toBe("kimi-code/k3-mid");
  });

  it("exit 0 senza risposta: probe non concludente, e il finding NON lo chiama bocciatura", () => {
    const sb = makeSandbox({ probe: "silent" });
    runAutoUpdate(sb);
    expect(sb.config()).toBe(FIELD_CONFIG);
    const msg = String(sb.mailbox()[0].msg);
    expect(msg).toContain("exited 0 without output");
    expect(msg).toContain("NOT a model rejection");
  });

  it("`To resume this session` non è un errore: non finisce mai nel motivo del fallimento", () => {
    // La riga compare anche sui successi. La prima versione la citava come
    // causa, e sul campo si è letto un falso negativo travestito da diagnosi.
    const sb = makeSandbox({ probe: "refuses" });
    const r = runAutoUpdate(sb);
    expect(r.out).toContain("model not available on your plan");
    expect(String(sb.mailbox()[0].msg)).not.toContain("To resume this session");
  });

  it("CLI che si pianta: il probe viene ucciso e il pin resta com'è", () => {
    const sb = makeSandbox({ probe: "hang" });
    const started = Date.now();
    const r = runAutoUpdate(sb, { JHT_MODEL_PIN_PROBE_TIMEOUT_SEC: "1" });
    expect(r.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(sb.config()).toBe(FIELD_CONFIG);
    expect(sb.backups()).toHaveLength(0);
  });

  it("senza credenziali non prova nemmeno: la CLI non potrebbe rispondere", () => {
    const sb = makeSandbox({ probe: "answers", credentials: false });
    const r = runAutoUpdate(sb);
    expect(r.out).toContain("missing credentials");
    expect(sb.probes()).toHaveLength(0);
    expect(sb.config()).toBe(FIELD_CONFIG);
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("stessa situazione a ogni riavvio: il finding non si ripete", () => {
    const sb = makeSandbox({ probe: "refuses" });
    runAutoUpdate(sb);
    runAutoUpdate(sb);
    runAutoUpdate(sb);
    expect(sb.mailbox()).toHaveLength(1);
    expect(sb.config()).toBe(FIELD_CONFIG);
  });
});

posixOnly("model pin — quando non c'è niente da promuovere", () => {
  it("il pin è già il migliore: nessun probe, nessuna scrittura, nessun rumore", () => {
    const sb = makeSandbox({
      probe: "answers",
      config: FIELD_CONFIG.replace('default_model = "kimi-code/kimi-for-coding"', 'default_model = "kimi-code/k3"'),
    });
    const r = runAutoUpdate(sb);
    expect(r.out).toContain("no alias with a wider window");
    expect(sb.probes()).toHaveLength(0);
    expect(sb.backups()).toHaveLength(0);
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("a parità di finestra non ci si muove: cambiare modello non è gratis", () => {
    const onlyEqual = `default_model = "kimi-code/kimi-for-coding"

[models."kimi-code/kimi-for-coding"]
  provider         = "managed:kimi-code"
  max_context_size = 262144

[models."kimi-code/kimi-for-coding-highspeed"]
  provider         = "managed:kimi-code"
  max_context_size = 262144
`;
    const sb = makeSandbox({ probe: "answers", config: onlyEqual });
    runAutoUpdate(sb);
    expect(defaultModelOf(sb.config())).toBe("kimi-code/kimi-for-coding");
    expect(sb.probes()).toHaveLength(0);
  });

  it("non salta su un provider diverso: sarebbe un trasloco, non una promozione", () => {
    const mixed = `default_model = "kimi-code/kimi-for-coding"

[models."kimi-code/kimi-for-coding"]
  provider         = "managed:kimi-code"
  max_context_size = 262144

[models."altro/gpt-4.1"]
  provider         = "openai-compat"
  max_context_size = 1047576
`;
    const sb = makeSandbox({ probe: "answers", config: mixed });
    runAutoUpdate(sb);
    expect(defaultModelOf(sb.config())).toBe("kimi-code/kimi-for-coding");
    expect(sb.probes()).toHaveLength(0);
  });

  it("config senza catalogo: non si inventa un alias", () => {
    const sb = makeSandbox({ probe: "answers", config: 'default_model = "kimi-code/kimi-for-coding"\n' });
    const r = runAutoUpdate(sb);
    expect(r.out).toContain("does not list any");
    expect(sb.probes()).toHaveLength(0);
    expect(sb.mailbox()).toHaveLength(0);
  });
});

posixOnly("model pin — chi lo ferma, e i provider che non si toccano", () => {
  it("JHT_MODEL_PIN: il modello è fissato dall'utente, non si prova e non si scrive", () => {
    const sb = makeSandbox({ probe: "answers" });
    const r = runAutoUpdate(sb, { JHT_MODEL_PIN: "kimi-code/kimi-for-coding" });
    expect(r.out).toContain("fixed by the user");
    expect(sb.probes()).toHaveLength(0);
    expect(sb.config()).toBe(FIELD_CONFIG);
    // Scelta esplicita dell'utente: non è una scoperta da riportare.
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("JHT_PROVIDER_AUTOUPDATE=0 ferma anche questo passo (boot invariato)", () => {
    const sb = makeSandbox({ probe: "answers" });
    const r = runAutoUpdate(sb, { JHT_PROVIDER_AUTOUPDATE: "0" });
    expect(r.code).toBe(0);
    expect(sb.probes()).toHaveLength(0);
    expect(sb.calls("sh")).toHaveLength(0);
    expect(sb.config()).toBe(FIELD_CONFIG);
  });

  it("fuori dal container non tocca il config del provider (è dell'utente del container)", () => {
    const sb = makeSandbox({ probe: "answers" });
    const r = runAutoUpdate(sb, { IS_CONTAINER: "0" });
    expect(r.out).toContain("outside the container");
    expect(sb.probes()).toHaveLength(0);
    expect(sb.config()).toBe(FIELD_CONFIG);
  });

  it("nessun config del provider: niente da rivedere, nessun rumore", () => {
    const sb = makeSandbox({ probe: "answers", config: null });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("no config");
    expect(sb.mailbox()).toHaveLength(0);
  });

  it("codex: il pin viene SEGNALATO ma il file non si tocca (contiene anche i trust_level)", () => {
    const codex = `model = "gpt-5.4"\nmodel_reasoning_effort = "high"\n\n[projects."/jht_home/agents/capitano"]\ntrust_level = "trusted"\n`;
    const sb = makeSandbox({ provider: "openai", codexConfig: codex });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("detected but not modified");
    expect(readFileSync(path.join(sb.home, ".codex", "config.toml"), "utf-8")).toBe(codex);

    const msg = String(sb.mailbox()[0].msg);
    expect(msg).toContain("gpt-5.4");
    expect(msg).toContain("user decision");
    expect(msg).toContain("session STARTS");
  });

  it("claude: nessun pin da rivedere, start-agent.sh passa --model a ogni spawn", () => {
    const sb = makeSandbox({ provider: "claude" });
    const r = runAutoUpdate(sb);
    expect(r.code).toBe(0);
    expect(r.out).toContain("not applicable");
    expect(sb.mailbox()).toHaveLength(0);
  });
});
