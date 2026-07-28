/**
 * [PROVIDER-MODEL-PIN] — addendum a [PROVIDER-CLI-AUTOUPDATE] dopo il primo
 * test in campo (2026-07-28).
 *
 * L'auto-update della CLI funziona ma NON basta: la CLI del provider si scrive
 * un pin di modello al primo login e non lo rivede mai piu'.
 *
 *   # $JHT_HOME/.kimi/config.toml — scritto al login, mai aggiornato
 *   default_model = "kimi-code/kimi-for-coding"
 *   [models."kimi-code/kimi-for-coding"]
 *     provider         = "managed:kimi-code"
 *     max_context_size = 262144
 *
 * Congela DUE cose: il modello e le sue capability. Quel 262144 e' la finestra
 * contro cui due agenti si sono bloccati a 565k e 168k token mentre il modello
 * nuovo ne dichiara 1M — quindi anche se il modello sotto cambiasse, il team
 * lavorerebbe con un quarto della finestra reale.
 *
 * Qui, al boot e subito dopo l'update della CLI, il pin viene RILEVATO,
 * VERIFICATO e — solo se la verifica e' conclusiva — INVALIDATO, cosi' la CLI
 * lo riscrive con i valori correnti al primo uso.
 *
 * ── La regola che decide se questo codice fa bene o danno ───────────────────
 * Cancellare un pin senza verificare puo' lasciare la CLI SENZA MODELLO: il
 * team non parte affatto. Un pin vecchio costa contesto; un pin cancellato male
 * costa l'intero team. Quindi la verifica NON e' "il provider ha annunciato un
 * modello nuovo" (non sa nulla del piano di questo account) ma:
 *
 *   si esegue la stessa identica mutazione su una COPIA del config e si lascia
 *   che sia la CLI, con le credenziali VERE di questo account, a dire quale
 *   modello risolve.
 *
 * Se sulla copia la CLI risolve un modello concreto con le sue capability,
 * allora la stessa mutazione sul file vero produrra' uno stato funzionante: e'
 * una prova per costruzione, non un'inferenza. Se la copia resta senza modello
 * (CLI che non riscrive, rete assente, credenziali scadute, timeout) la
 * verifica e' INCONCLUSIVA e non si tocca niente: un team che lavora su un
 * modello vecchio e' enormemente meglio di un team fermo.
 *
 * Copertura per provider — vedi PIN_SPECS piu' sotto: kimi e' l'unico che viene
 * modificato; codex e' solo rilevato e segnalato; claude non e' applicabile.
 */
import {
  existsSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync,
  renameSync, statSync, chmodSync, mkdirSync, unlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';

const MP = '[model-pin]';

// Tetto per singola invocazione di probe. Vale la stessa logica del timeout
// dell'update: al boot chi aspetta e' il container intero, e una CLI che
// aspetta input o rete non deve tenerlo in ostaggio.
const PROBE_TIMEOUT_MS =
  (Number(process.env.JHT_MODEL_PIN_PROBE_TIMEOUT_SEC) || 90) * 1000;

/**
 * Pin DELIBERATO dell'utente: l'unica cosa che deve impedire l'aggiornamento
 * automatico del modello (vincolo esplicito del ticket). Serve a riprodurre un
 * bug su un modello preciso o a contenere i costi.
 *
 * Accetta qualunque valore non vuoto: `JHT_MODEL_PIN=1` come `JHT_MODEL_PIN=
 * kimi-code/kimi-for-coding`. Il valore viene solo LOGGATO (non applicato):
 * JHT non passa `--model` a kimi/codex — start-agent.sh lascia deliberatamente
 * il default al provider — quindi qui l'unico effetto onesto e' "non toccare".
 *
 * NON si e' riusato `jht.config.json → providers.<id>.model`: il wizard lo
 * scrive SEMPRE (primo elemento di una lista hardcoded, cli/wizard/setup-
 * helpers.js) e nessuno lo passa alla CLI per kimi/codex. Prenderlo per una
 * volonta' dell'utente avrebbe spento questa funzione per tutti, sempre.
 */
function deliberatePin() {
  const raw = (process.env.JHT_MODEL_PIN ?? '').trim();
  if (!raw || raw === '0' || raw.toLowerCase() === 'false' || raw.toLowerCase() === 'off') return null;
  return raw;
}

// ── TOML: lettura ed editing chirurgico ─────────────────────────────────────
// Niente parser TOML completo (e niente dipendenza nuova): serve leggere UNA
// chiave top-level e UNA tabella, e rimuoverle preservando tutto il resto —
// commenti, [loop_control] (max_steps_per_turn e' stato calibrato a mano),
// [providers.*] con le credenziali, gli altri [models.*] dichiarati dall'utente.
// Un round-trip parse→serialize li perderebbe o li riscriverebbe a caso.

function unquote(raw) {
  const v = (raw ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).replace(/\\"/g, '"');
  }
  return v;
}

function isTableHeader(line) {
  return /^\s*\[/.test(line);
}

/** Chiave top-level (= prima di qualunque header di tabella), commenti esclusi. */
function readTopLevelKey(lines, key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (isTableHeader(lines[i])) break;
    if (/^\s*#/.test(lines[i])) continue;
    const m = re.exec(lines[i]);
    if (m) return { value: unquote(m[1]), index: i };
  }
  return null;
}

/**
 * Tabella `[<parent>.<name>]` con name in una qualunque delle forme che
 * scrivono le CLI: `[models."a/b"]`, `[models.'a/b']`, `[models.plain]`.
 * Ritorna l'intervallo di righe [start, end) e il corpo.
 */
function findTable(lines, parent, name) {
  const headerRe = new RegExp(`^\\s*\\[\\s*${parent}\\s*\\.\\s*(.+?)\\s*\\]\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const m = headerRe.exec(lines[i]);
    if (!m || unquote(m[1]) !== name) continue;
    let end = i + 1;
    while (end < lines.length && !isTableHeader(lines[end])) end++;
    return { start: i, end, body: lines.slice(i + 1, end) };
  }
  return null;
}

/** Coppie chiave=valore semplici di una tabella (numeri come numeri). */
function parseTableBody(body) {
  const out = {};
  for (const line of body) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const raw = m[2];
    out[m[1]] = /^-?\d+$/.test(raw) ? Number(raw) : unquote(raw);
  }
  return out;
}

/**
 * Il pin come lo scrive la CLI: chiave top-level col modello di default + la
 * tabella che ne congela le capability.
 */
function readPin(text, { defaultKey, tableParent }) {
  const lines = text.split('\n');
  const key = readTopLevelKey(lines, defaultKey);
  if (!key || !key.value) return null;
  const table = tableParent ? findTable(lines, tableParent, key.value) : null;
  return {
    model: key.value,
    caps: table ? parseTableBody(table.body) : {},
    keyIndex: key.index,
    table,
  };
}

/** Rimuove riga del default + tabella delle capability, lasciando il resto. */
function stripPin(text, pin, note) {
  const lines = text.split('\n');
  const kill = new Set([pin.keyIndex]);
  if (pin.table) {
    for (let i = pin.table.start; i < pin.table.end; i++) kill.add(i);
  }
  const kept = lines.filter((_, i) => !kill.has(i));
  // Il taglio lascia buchi: comprimi le righe vuote consecutive a una sola,
  // cosi' il file resta leggibile per chi lo aprira' dopo.
  const compact = kept.filter((l, i) => !(l.trim() === '' && (kept[i - 1] ?? '').trim() === ''));
  return (note ? `${note}\n` : '') + compact.join('\n').replace(/^\n+/, '');
}

function fingerprint(pin) {
  const ctx = pin.caps.max_context_size ?? '?';
  const name = pin.caps.display_name ?? '';
  return `${pin.model}|${ctx}|${name}`;
}

function describePin(pin) {
  const bits = [`\`${pin.model}\``];
  if (pin.caps.max_context_size) bits.push(`ctx ${pin.caps.max_context_size}`);
  if (pin.caps.display_name) bits.push(`"${pin.caps.display_name}"`);
  return bits.join(', ');
}

// ── Probe: la CLI stessa, su una copia del config, con le credenziali vere ──

/**
 * Esegue la CLI su un config di scarto e restituisce il pin che la CLI ci
 * scrive (se ce lo scrive). Nessuna copia delle credenziali: si punta alla
 * share dir VERA. Copiare le credenziali sarebbe stato peggio del male —
 * un refresh OAuth nella copia puo' ruotare il refresh token e invalidare
 * quello vero, lasciando il team senza autenticazione.
 *
 * Ladder di invocazioni, dalla piu' economica alla piu' probante:
 *   1. `info`            → locale, costo zero: basta se la CLI materializza il
 *                          config all'avvio.
 *   2. `--quiet -p ok`   → un turno non-interattivo minimo. Costa una richiesta
 *                          ridicola e in cambio prova che il modello risolto
 *                          RISPONDE davvero su questo piano (un modello elencato
 *                          ma fuori piano fallisce qui, non nel file).
 * Il passo 2 parte solo se il passo 1 non ha prodotto un modello.
 */
function probeResolvedPin(spec, strippedText, log) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-model-pin-'));
  const probeCfg = join(dir, 'config.toml');
  writeFileSync(probeCfg, strippedText, 'utf-8');

  const env = { ...process.env, ...spec.probeEnv(), HOME: JHT_HOME };
  let lastReason = 'nessun tentativo';

  for (const args of spec.probeArgs(probeCfg)) {
    // Il path della copia e' rumore in un finding: si mostra il comando, non la
    // temp dir che sara' sparita quando il Capitano lo legge.
    const shown = `${spec.bin} ${args.map((a) => (a === probeCfg ? '<copia-del-config>' : a)).join(' ')}`;
    log(`${MP} probe: ${shown} (copia in ${probeCfg})`);
    let r;
    try {
      r = spawnSync(spec.bin, args, {
        // cwd usa e getta: il passo 2 e' un turno vero e `--print` implica
        // `--afk` (tool call auto-approvate). Se il modello decidesse di
        // toccare il disco, lo farebbe qui dentro e non nella home del team.
        cwd: dir,
        env,
        encoding: 'utf-8',
        timeout: PROBE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        // stdin chiuso: `--print` legge da stdin e senza questo resterebbe
        // appeso fino al timeout invece di rispondere al prompt passato.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      lastReason = `${shown}: ${err.message}`;
      continue;
    }
    if (r.error) {
      lastReason = `${shown}: ${r.error.message}`;
      continue;
    }
    if (r.signal) {
      lastReason = `${shown} ucciso da ${r.signal} (timeout ${PROBE_TIMEOUT_MS / 1000}s)`;
      continue;
    }
    let resolved = null;
    try {
      resolved = readPin(readFileSync(probeCfg, 'utf-8'), spec);
    } catch { /* file sparito: trattato come non risolto */ }
    if (resolved?.model) {
      try { unlinkSync(probeCfg); } catch { /* best effort */ }
      return { ok: true, pin: resolved, via: shown };
    }
    lastReason = r.status === 0
      ? `${shown} e' uscito 0 ma non ha scritto nessun modello nel config di prova`
      : `${shown} exit ${r.status}${r.stderr ? ` — ${String(r.stderr).trim().split('\n').pop()}` : ''}`;
  }
  try { unlinkSync(probeCfg); } catch { /* best effort */ }
  return { ok: false, reason: lastReason };
}

// ── Spec per provider ───────────────────────────────────────────────────────
// I tre provider NON pinnano allo stesso modo, quindi non c'e' un caso unico:
//
//   kimi   — $JHT_HOME/.kimi/config.toml (override KIMI_SHARE_DIR). Pin scritto
//            al login: `default_model` + `[models."<id>"]` con max_context_size.
//            E' il caso osservato sul campo ed e' l'unico MUTABILE, perche' e'
//            anche l'unico dove la verifica e' possibile: la CLI, senza pin,
//            si riscrive il config da sola (documentato: "on first run, if the
//            configuration file doesn't exist, Kimi Code CLI will automatically
//            create a default configuration file") — quindi il probe puo'
//            osservare l'esito della stessa mutazione su una copia.
//
//   codex  — $JHT_HOME/.codex/config.toml. Il login NON scrive un modello; ci
//            finisce un `model = "..."` solo se qualcuno lo sceglie dalla TUI
//            (/model) o lo scrive a mano. SOLO RILEVATO, mai modificato:
//            (a) togliendo `model` codex ricade sul default COMPILATO nel
//                binario, che non riscrive nel file — il probe non ha nulla da
//                leggere e la verifica sarebbe una scommessa;
//            (b) quel file contiene anche le entry `[projects."…"] trust_level`
//                che scrive start-agent.sh: senza trust, gli agenti codex si
//                piantano sul prompt "Do you trust this directory?".
//            Se il pin c'e', il Capitano lo riceve come finding e decide l'utente.
//
//   claude — NON APPLICABILE. start-agent.sh passa `--model opus|sonnet` a
//            OGNI spawn: l'argomento vince su qualunque preferenza salvata, e
//            gli alias `opus`/`sonnet` seguono la generazione corrente da soli.
//            Non c'e' drift da correggere e ~/.claude.json contiene i flag di
//            onboarding che JHT stesso pre-seed a: riscriverlo sarebbe rischio
//            senza guadagno.
const PIN_SPECS = {
  kimi: {
    bin: 'kimi',
    mutable: true,
    defaultKey: 'default_model',
    tableParent: 'models',
    shareDir: () => process.env.KIMI_SHARE_DIR || join(JHT_HOME, '.kimi'),
    configPath() { return join(this.shareDir(), 'config.toml'); },
    // Senza credenziali la CLI non puo' risolvere niente: si esce prima di
    // toccare qualunque cosa (ed e' il caso del primo boot, dove il login che
    // sta per arrivare scrivera' comunque valori correnti).
    credentials() {
      return [
        join(this.shareDir(), 'credentials', 'kimi-code.json'),
        join(this.shareDir(), 'kimi.json'),
      ];
    },
    probeEnv() {
      return { KIMI_SHARE_DIR: this.shareDir(), KIMI_CLI_NO_AUTO_UPDATE: '1' };
    },
    probeArgs(cfg) {
      return [
        ['--config-file', cfg, 'info'],
        ['--config-file', cfg, '--quiet', '-p', 'ok'],
      ];
    },
  },
  codex: {
    bin: 'codex',
    mutable: false,
    defaultKey: 'model',
    tableParent: null,
    configPath: () => join(JHT_HOME, '.codex', 'config.toml'),
    detectOnlyReason:
      'il default di codex non e\' scritto nel file (sta nel binario), quindi togliere il pin '
      + 'non e\' verificabile con una prova; e lo stesso file contiene le entry trust_level '
      + 'degli agenti',
  },
  claude: {
    bin: 'claude',
    applicable: false,
    notApplicableReason:
      'start-agent.sh passa --model opus|sonnet a ogni spawn (l\'argomento vince sul config) '
      + 'e gli alias seguono la generazione corrente: nessun pin da invalidare',
  },
};

// ── Stato fra un boot e l'altro ─────────────────────────────────────────────
// Due motivi, entrambi imparati a caro prezzo su passi che girano AL BOOT:
//   • niente spam: un container che riparte dieci volte non deve consegnare
//     dieci volte lo stesso finding al Capitano;
//   • niente loop di riscritture: se dopo un'invalidazione la CLI ri-pinna lo
//     STESSO valore, il meccanismo non funziona su questa versione — si smette
//     di riprovare a ogni boot invece di riscrivere il config all'infinito.
const STATE_PATH = () => join(JHT_HOME, 'logs', 'model-pin-state.json');

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH(), 'utf-8')); } catch { return null; }
}

function writeState(state) {
  try {
    mkdirSync(dirname(STATE_PATH()), { recursive: true });
    writeFileSync(STATE_PATH(), JSON.stringify(state, null, 2) + '\n', 'utf-8');
  } catch { /* best effort: lo stato e' un'ottimizzazione, non una dipendenza */ }
}

// ── Backup + riscrittura ────────────────────────────────────────────────────

/**
 * Backup PRIMA di toccare un file che non e' nostro, e scrittura atomica.
 * Il backup e' una precondizione: se non riesce, non si riscrive niente.
 */
function backupAndWrite(path, nextText, log) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const backup = `${path}.bak-model-pin-${stamp}`;
  const original = statSync(path);
  copyFileSync(path, backup);
  if (!existsSync(backup) || statSync(backup).size !== original.size) {
    throw new Error(`backup incompleto (${backup})`);
  }
  const tmp = `${path}.jht-model-pin.tmp`;
  writeFileSync(tmp, nextText, 'utf-8');
  try { chmodSync(tmp, original.mode & 0o7777); } catch { /* fs senza permessi POSIX */ }
  renameSync(tmp, path);
  log(`${MP} backup: ${backup}`);
  return backup;
}

// ── Passo di boot ───────────────────────────────────────────────────────────

/**
 * Rileva / verifica / (solo se conclusivo) invalida il pin di modello del
 * provider attivo. NON LANCIA MAI: qualunque errore diventa un log e il boot
 * prosegue — vale la stessa regola fail-safe del resto del ticket.
 *
 * @param {object}   opts
 * @param {string}   opts.target        chiave di spec: claude | codex | kimi
 * @param {Function} opts.notifyCaptain (msg) => boolean — mailbox del bridge
 * @param {boolean}  [opts.dryRun]      verifica e riporta, non scrive nulla
 * @returns {Promise<{outcome: string, detail?: string}>}
 */
export async function refreshModelPin({ target, notifyCaptain, dryRun = false, log = console.log }) {
  try {
    return runRefresh({ target, notifyCaptain, dryRun, log });
  } catch (err) {
    log(`${MP} errore inatteso: ${err?.message ?? err} — pin lasciato com'e', il team parte`);
    return { outcome: 'ERROR', detail: String(err?.message ?? err) };
  }
}

function runRefresh({ target, notifyCaptain, dryRun, log }) {
  const spec = PIN_SPECS[target];
  if (!spec) {
    log(`${MP} provider '${target}' senza spec di pin: niente da controllare`);
    return { outcome: 'NO_SPEC' };
  }
  if (spec.applicable === false) {
    log(`${MP} ${target}: non applicabile — ${spec.notApplicableReason}`);
    return { outcome: 'NOT_APPLICABLE' };
  }

  const configPath = spec.configPath();
  if (!existsSync(configPath)) {
    log(`${MP} ${target}: nessun config in ${configPath} — niente pin da rivedere`);
    return { outcome: 'NO_CONFIG' };
  }

  let text;
  try {
    text = readFileSync(configPath, 'utf-8');
  } catch (err) {
    log(`${MP} ${target}: ${configPath} illeggibile (${err.message}) — non tocco niente`);
    return { outcome: 'UNREADABLE' };
  }

  const pin = readPin(text, spec);
  if (!pin) {
    log(`${MP} ${target}: nessun pin in ${configPath} (${spec.defaultKey} assente) — la CLI usa il default corrente`);
    return { outcome: 'NO_PIN' };
  }
  log(`${MP} ${target}: pin trovato in ${configPath} → ${describePin(pin)}`);

  const state = readState();
  const signature = `${target}|${fingerprint(pin)}`;
  const seen = state && state.signature === signature;
  // Un finding per situazione, non per riavvio.
  const report = (msg, outcome) => {
    if (seen && state.outcome === outcome) {
      log(`${MP} finding gia' consegnato per questa situazione (${outcome}) — non lo ripeto`);
      return;
    }
    if (notifyCaptain?.(msg)) log(`${MP} finding consegnato al Capitano (mailbox bridge)`);
  };
  const finish = (outcome, detail) => {
    writeState({ ts: new Date().toISOString(), provider: target, signature, outcome, detail });
    return { outcome, detail };
  };

  // 1. Pin deliberato dell'utente: e' l'UNICA cosa che ferma l'aggiornamento
  //    automatico. Nessun finding: e' una scelta esplicita, non una scoperta.
  const deliberate = deliberatePin();
  if (deliberate) {
    log(`${MP} ${target}: JHT_MODEL_PIN=${deliberate} — modello fissato dall'utente, non tocco il pin`);
    return finish('DELIBERATE_PIN', deliberate);
  }

  // 2. Provider che rileviamo ma non modifichiamo.
  if (!spec.mutable) {
    log(`${MP} ${target}: rilevato ma NON modificabile — ${spec.detectOnlyReason}`);
    report([
      `📌 [FINDING] Il config di ${target} contiene un pin di modello: ${describePin(pin)} (${configPath}).`,
      'JHT non lo tocca da solo:',
      `${spec.detectOnlyReason}.`,
      'Finche\' resta li\', quel modello e\' quello che il team usa anche se il provider ne ha promosso uno piu\' recente:',
      'cambiarlo altera costo, comportamento e finestra di contesto, quindi e\' una decisione dell\'utente — portagliela.',
    ].join(' '), 'DETECT_ONLY');
    return finish('DETECT_ONLY', pin.model);
  }

  // 3. Senza credenziali la CLI non puo' risolvere niente: verificare e'
  //    impossibile e invalidare sarebbe cieco. (E' anche il primo boot: il
  //    login che sta per arrivare scrivera' comunque valori correnti.)
  const creds = spec.credentials?.() ?? [];
  if (creds.length > 0 && !creds.some((p) => existsSync(p))) {
    log(`${MP} ${target}: credenziali assenti (${creds.join(', ')}) — verifica impossibile, pin intatto`);
    return finish('NO_CREDENTIALS');
  }

  // 4. Anti-loop: se per QUESTO stesso pin abbiamo gia' invalidato una volta e
  //    la CLI l'ha riscritto identico, il meccanismo non funziona su questa
  //    versione della CLI. Riprovare a ogni boot riscriverebbe il config in
  //    eterno senza spostare niente.
  if (seen && state.outcome === 'INVALIDATED') {
    log(`${MP} ${target}: pin gia' invalidato in un boot precedente e riscritto identico dalla CLI — non riprovo (finding gia' consegnato)`);
    return { outcome: 'ALREADY_TRIED', detail: pin.model };
  }

  // 5. La verifica: la stessa mutazione, su una copia, con le credenziali vere.
  const stripped = stripPin(text, pin, null);
  const probe = probeResolvedPin(spec, stripped, log);

  if (!probe.ok) {
    log(`${MP} ${target}: verifica INCONCLUSIVA (${probe.reason}) — pin lasciato com'e'`);
    report([
      `⚠️ [FINDING] Pin di modello RILEVATO ma NON toccato (${target}): ${describePin(pin)}.`,
      'Lo ha scritto la CLI al primo login e congela ANCHE la finestra di contesto.',
      `Non ho potuto verificare che il default corrente sia utilizzabile su questo account (${probe.reason}),`,
      'quindi il pin resta invariato: un team su un modello vecchio e\' meglio di un team fermo.',
      `Per rifare la verifica a mano: \`jht providers model-pin --dry-run\` (config: ${configPath}).`,
    ].join(' '), 'INCONCLUSIVE');
    return finish('INCONCLUSIVE', probe.reason);
  }

  const fresh = probe.pin;
  if (fingerprint(fresh) === fingerprint(pin)) {
    log(`${MP} ${target}: pin GIA' CORRENTE (${describePin(pin)}) — niente da fare`);
    return finish('UP_TO_DATE', pin.model);
  }

  if (dryRun) {
    log(`${MP} ${target}: [dry-run] invaliderei il pin ${describePin(pin)} → ${describePin(fresh)} (verificato con: ${probe.via})`);
    return { outcome: 'WOULD_INVALIDATE', detail: fresh.model };
  }

  // 6. Solo ora si scrive. Backup prima, scrittura atomica dopo.
  let backup;
  const note = `# ${new Date().toISOString().slice(0, 10)} JHT [PROVIDER-MODEL-PIN]: rimossi ${spec.defaultKey} e il blocco delle capability`
    + ` di "${pin.model}" (ctx ${pin.caps.max_context_size ?? '?'}), congelati al login. La CLI li riscrive al primo uso.`;
  try {
    backup = backupAndWrite(configPath, stripPin(text, pin, note), log);
  } catch (err) {
    log(`${MP} ${target}: riscrittura ANNULLATA (${err.message}) — pin intatto`);
    return finish('WRITE_FAILED', err.message);
  }

  log(`${MP} ${target}: pin INVALIDATO — ${describePin(pin)} → ${describePin(fresh)} (verificato con: ${probe.via})`);
  report([
    `🔄 [FINDING] Pin di modello invalidato al boot (${target}): ${describePin(pin)} → ${describePin(fresh)}.`,
    'Lo aveva scritto la CLI al primo login e non lo rivedeva piu\': congelava il modello E la finestra di contesto',
    '(e\' la finestra contro cui gli agenti si sono bloccati).',
    'Verificato PRIMA di toccare il file: sulla stessa mutazione fatta su una copia del config, la CLI con le credenziali',
    `di questo account ha risolto il modello nuovo (${probe.via}).`,
    `Backup: ${backup} — per tornare indietro: \`cp ${backup} ${configPath}\` e riavvia il team.`,
    'Un cambio di modello altera costo, comportamento e finestra: l\'utente deve saperlo, anche quando e\' desiderato — portaglielo.',
  ].join(' '), 'INVALIDATED');
  return finish('INVALIDATED', `${pin.model} → ${fresh.model}`);
}

// Esportati per i test / diagnostica.
export const __internals = { readPin, stripPin, PIN_SPECS, deliberatePin };
