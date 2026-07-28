/**
 * [PROVIDER-MODEL-PIN] — addendum a [PROVIDER-CLI-AUTOUPDATE], riscritto dopo
 * il test in campo delle 15:55 del 2026-07-28.
 *
 * La CLI del provider si scrive un pin al primo login e non lo rivede mai piu':
 *
 *   # $JHT_HOME/.kimi/config.toml — scritto al login, mai aggiornato
 *   default_model = "kimi-code/kimi-for-coding"
 *   [models."kimi-code/kimi-for-coding"]
 *     max_context_size = 262144
 *
 * Congela DUE cose: il modello e le sue capability. Quel 262144 e' la finestra
 * contro cui due agenti si sono bloccati a 565k e 168k token mentre il modello
 * nuovo ne dichiara 1M.
 *
 * ── Cosa ha insegnato il campo (e cosa e' cambiato qui) ─────────────────────
 *
 * 1. INVALIDARE NON BASTA: VA SOSTITUITO. La prima versione toglieva
 *    `default_model` aspettandosi che la CLI lo riscrivesse aggiornato. Non
 *    funziona: la CLI lo riscrive puntando di nuovo al VECCHIO alias, perche'
 *    quello e' il default del piano. Cio' che ha funzionato in produzione e'
 *    stata la sostituzione esplicita dell'alias. Quindi qui si SCEGLIE e si
 *    SCRIVE, non si cancella sperando.
 *
 * 2. GLI ALIAS SONO GIA' NEL FILE. Il config elenca i `[models."…"]` che
 *    l'account espone (sul campo: kimi-for-coding, kimi-for-coding-highspeed,
 *    k3, k3-256k). Non serve piu' indovinare cosa il piano offre: lo dice il
 *    file. Il criterio di scelta non e' il nome — cambia a ogni generazione —
 *    ma la capability dichiarata: la `max_context_size` piu' alta.
 *
 * 3. IL PROBE DAVA FALSO NEGATIVO. Interrogava una COPIA DEL CONFIG SENZA PIN:
 *    cosi' la CLI restava senza modello risolto e usciva 1 — un fallimento
 *    della copia, non del modello. Lo stesso modello, chiesto per nome,
 *    rispondeva (`kimi --model kimi-code/k3 --quiet -p "rispondi solo: ok"` →
 *    exit 0). Ora il probe chiede l'ALIAS CANDIDATO per nome su una copia
 *    INTATTA del config, cioe' la stessa invocazione provata a mano sulla
 *    macchina. Cosi' un fallimento significa "quell'alias non risponde" e non
 *    "il probe non ha saputo chiedere".
 *
 * Resta il principio che vale piu' di tutti: PROVA PRIMA DI SCRIVERE. Se il
 * candidato non risponde, non lo si scrive. Un pin vecchio costa contesto; un
 * pin scritto male costa l'intero team.
 */
import {
  existsSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, readdirSync,
  renameSync, statSync, chmodSync, mkdirSync, unlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';

const MP = '[model-pin]';

// Tetto per singola invocazione di probe. Vale la stessa logica del timeout
// dell'update: al boot chi aspetta e' il container intero, e una CLI che
// aspetta input o rete non deve tenerlo in ostaggio.
const PROBE_TIMEOUT_MS =
  (Number(process.env.JHT_MODEL_PIN_PROBE_TIMEOUT_SEC) || 90) * 1000;

// Quanti backup tenere. Se la CLI rimette il default del piano a ogni login, il
// passo ri-scrive la sua scelta a ogni boot: senza potatura la share dir si
// riempirebbe di .bak. I piu' recenti sono anche gli unici utili.
const KEEP_BACKUPS = 3;

/**
 * Pin DELIBERATO dell'utente: l'unica cosa che deve impedire l'aggiornamento
 * automatico del modello (vincolo esplicito del ticket). Serve a riprodurre un
 * bug su un modello preciso o a contenere i costi.
 *
 * Accetta qualunque valore non vuoto: `JHT_MODEL_PIN=1` come `JHT_MODEL_PIN=
 * kimi-code/kimi-for-coding`. Il valore viene solo LOGGATO (non applicato): chi
 * vuole un modello preciso lo scrive nel config del provider, qui l'unico
 * effetto onesto e' "non toccare".
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
// chiave top-level e le tabelle `[models.*]`, e riscrivere UNA riga preservando
// tutto il resto — commenti, [loop_control] (max_steps_per_turn e' stato
// calibrato a mano), [providers.*] con le credenziali, gli altri [models.*].
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

/** Riga di commento lasciata da noi in un passaggio precedente. */
function isOurNote(line) {
  return /^#.*\[PROVIDER-MODEL-PIN\]/.test(line);
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
 * Il catalogo che il config gia' elenca: ogni `[models."<alias>"]` con le sue
 * capability. E' la risposta dell'account alla domanda "cosa posso usare" —
 * scritta dalla CLI al login, non indovinata da noi.
 */
function readModelCatalog(text, tableParent) {
  if (!tableParent) return [];
  const lines = text.split('\n');
  const headerRe = new RegExp(`^\\s*\\[\\s*${tableParent}\\s*\\.\\s*(.+?)\\s*\\]\\s*$`);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = headerRe.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && !isTableHeader(lines[end])) end++;
    out.push({ alias: unquote(m[1]), caps: parseTableBody(lines.slice(i + 1, end)) });
  }
  return out;
}

/** Il pin corrente: modello di default + le capability che il file gli attribuisce. */
function readPin(text, spec) {
  const lines = text.split('\n');
  const key = readTopLevelKey(lines, spec.defaultKey);
  if (!key || !key.value) return null;
  const entry = readModelCatalog(text, spec.tableParent).find((m) => m.alias === key.value);
  return { model: key.value, caps: entry?.caps ?? {}, keyIndex: key.index };
}

const ctxOf = (caps) => Number(caps?.max_context_size) || 0;

/**
 * I candidati migliori fra quelli che il config gia' elenca, dal migliore in giu'.
 *
 * Criterio: NON il nome (cambia a ogni generazione: kimi-for-coding, k3, …) ma
 * la capability dichiarata nel file, cioe' la finestra di contesto — che e'
 * anche il motivo per cui questo ticket esiste. Nel caso osservato sul campo
 * `k3` (1048576) batte `k3-256k` (262144): stesso modello, finestra diversa.
 *
 * Due filtri prudenti:
 *   • solo alias dello STESSO provider del pin corrente (`managed:kimi-code`):
 *     saltare su un provider diverso vorrebbe dire un'altra autenticazione e
 *     un'altra fatturazione — non e' una promozione, e' un trasloco;
 *   • solo alias STRETTAMENTE migliori: a parita' di finestra non ci si muove.
 *     Non c'e' niente da guadagnare e ogni cambio di modello cambia costo e
 *     comportamento.
 *
 * Si ritorna la lista e non il solo vincitore: se il primo non risponde al
 * probe si prova il successivo, invece di rinunciare.
 */
function rankCandidates(catalog, pin) {
  const currentCtx = ctxOf(pin?.caps);
  const wantProvider = pin?.caps?.provider;
  return catalog
    .filter((m) => m.alias !== pin?.model)
    .filter((m) => !wantProvider || !m.caps.provider || m.caps.provider === wantProvider)
    .filter((m) => ctxOf(m.caps) > currentCtx)
    .sort((a, b) => ctxOf(b.caps) - ctxOf(a.caps) || a.alias.localeCompare(b.alias));
}

/**
 * Scrive `default_model = "<alias>"`: sostituisce la riga se c'e', la aggiunge
 * in testa se manca (e' lo stato in cui la PRIMA versione di questo passo puo'
 * aver lasciato qualche box: pin rimosso e mai riscritto).
 * Le vecchie note di JHT vengono tolte, cosi' non si accumulano a ogni boot.
 */
function setDefaultModel(text, spec, alias, note) {
  const lines = text.split('\n').filter((l) => !isOurNote(l));
  const line = `${spec.defaultKey} = "${alias}"`;
  // Si ri-cerca sul testo ripulito invece di fidarsi dell'indice calcolato
  // prima: le uniche righe tolte sono note nostre, ma un indice stantio
  // riscriverebbe la riga sbagliata.
  const found = readTopLevelKey(lines, spec.defaultKey);
  if (found) lines[found.index] = line;
  else lines.unshift(line);
  return (note ? `${note}\n` : '') + lines.join('\n').replace(/^\n+/, '');
}

function describeModel(alias, caps) {
  const bits = [`\`${alias}\``];
  if (caps?.max_context_size) bits.push(`ctx ${caps.max_context_size}`);
  if (caps?.display_name) bits.push(`"${caps.display_name}"`);
  return bits.join(', ');
}

const describePin = (pin) => describeModel(pin.model, pin.caps);

// ── Probe: l'alias candidato, chiesto per nome, su una copia intatta ────────

/**
 * Il rumore che la CLI stampa anche quando va tutto bene. `To resume this
 * session: kimi -r <uuid>` compare ANCHE sui successi: infilarlo nel motivo di
 * un fallimento (come faceva la prima versione) fa sembrare causa quella che e'
 * solo la firma in calce.
 */
function meaningfulTail(stream) {
  const lines = String(stream || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/to resume this session/i.test(l));
  return lines.length ? lines[lines.length - 1].slice(0, 200) : '';
}

/**
 * Chiede a UN alias di rispondere, davvero.
 *
 * La copia del config e' INTATTA — con il suo `default_model` e tutti i
 * `[models.*]` — e l'alias si seleziona con `--model`. E' la differenza con la
 * versione che dava falso negativo: prima si consegnava alla CLI un config
 * privato del pin, e la CLI usciva 1 perche' non aveva NESSUN modello da usare.
 * Ora l'unica variabile e' l'alias, quindi un fallimento parla dell'alias.
 *
 * La copia serve comunque: finche' il candidato non ha risposto, il file vero
 * non si tocca. Le credenziali non si copiano MAI — la share dir e' quella
 * vera — perche' un refresh OAuth dentro una copia puo' ruotare il refresh
 * token e invalidare quello buono: sarebbe un danno peggiore del pin.
 */
function probeCandidate(spec, configText, alias, log) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-model-pin-'));
  const probeCfg = join(dir, 'config.toml');
  writeFileSync(probeCfg, configText, 'utf-8');
  const args = spec.probeArgs(probeCfg, alias);
  const shown = `${spec.bin} ${args.map((a) => (a === probeCfg ? '<copia-del-config>' : a)).join(' ')}`;
  log(`${MP} probe: ${shown}`);

  let r;
  try {
    r = spawnSync(spec.bin, args, {
      // cwd usa e getta: e' un turno vero e `--print` implica `--afk` (tool
      // call auto-approvate). Se il modello decidesse di toccare il disco, lo
      // farebbe qui dentro e non nella home del team.
      cwd: dir,
      env: { ...process.env, ...spec.probeEnv(), HOME: JHT_HOME },
      encoding: 'utf-8',
      timeout: PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      // stdin chiuso: `--print` legge da stdin e senza questo resterebbe
      // appeso fino al timeout invece di rispondere al prompt passato.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return { ok: false, reason: `${alias}: ${err.message}` };
  } finally {
    try { unlinkSync(probeCfg); } catch { /* best effort */ }
  }

  if (r.error) return { ok: false, reason: `${alias}: ${r.error.message}` };
  if (r.signal) {
    return { ok: false, reason: `${alias}: ucciso da ${r.signal} dopo ${PROBE_TIMEOUT_MS / 1000}s` };
  }

  const answer = String(r.stdout || '').trim();
  // Due esiti da tenere distinti, ed e' il punto dell'intera correzione:
  //   • exit != 0             → l'alias non e' utilizzabile su questo account
  //   • exit 0 ma zero output → la CLI non ha risposto: non e' una bocciatura
  //                             del modello, e' un probe che non ha saputo
  //                             chiedere. In entrambi i casi non si scrive, ma
  //                             il motivo che arriva al Capitano e' diverso.
  if (r.status !== 0) {
    const tail = meaningfulTail(r.stderr) || meaningfulTail(r.stdout);
    return { ok: false, reason: `${alias} non ha risposto (exit ${r.status}${tail ? ` — ${tail}` : ''})` };
  }
  if (!answer) {
    return {
      ok: false,
      reason: `${alias}: la CLI e' uscita 0 senza stampare niente — probe non concludente, NON una bocciatura del modello`,
    };
  }
  return { ok: true, via: shown, answer: answer.split('\n').pop().slice(0, 80) };
}

// ── Spec per provider ───────────────────────────────────────────────────────
// I tre provider NON pinnano allo stesso modo, quindi non c'e' un caso unico:
//
//   kimi   — $JHT_HOME/.kimi/config.toml (override KIMI_SHARE_DIR). Pin scritto
//            al login: `default_model` + i `[models."<alias>"]` con le
//            capability. E' il caso osservato sul campo ed e' l'unico MUTABILE,
//            perche' e' anche l'unico dove il file ELENCA le alternative: si
//            sceglie fra quelle, si prova, si scrive.
//
//   codex  — $JHT_HOME/.codex/config.toml. Il login NON scrive un modello; ci
//            finisce un `model = "..."` solo se qualcuno lo sceglie dalla TUI
//            (/model) o lo scrive a mano. SOLO RILEVATO, mai modificato:
//            (a) il suo config non elenca alternative — non c'e' catalogo da
//                cui scegliere, e un nome inventato da noi lascerebbe la CLI
//                con un pin che non risolve, cioe' il team fermo;
//            (b) quel file contiene anche le entry `[projects."…"] trust_level`
//                che scrive start-agent.sh: senza trust, gli agenti codex si
//                piantano sul prompt "Do you trust this directory?".
//            Se il pin c'e', il Capitano lo riceve come finding e decide l'utente.
//
//   claude — NON APPLICABILE. start-agent.sh passa `--model opus|sonnet` a
//            OGNI spawn: l'argomento vince su qualunque preferenza salvata, e
//            gli alias `opus`/`sonnet` seguono la generazione corrente da soli.
//            Non c'e' drift da correggere e ~/.claude.json contiene i flag di
//            onboarding che JHT stesso pre-seeda: riscriverlo sarebbe rischio
//            senza guadagno.
const PIN_SPECS = {
  kimi: {
    bin: 'kimi',
    mutable: true,
    defaultKey: 'default_model',
    tableParent: 'models',
    shareDir: () => process.env.KIMI_SHARE_DIR || join(JHT_HOME, '.kimi'),
    configPath() { return join(this.shareDir(), 'config.toml'); },
    // Senza credenziali la CLI non puo' rispondere: provare e' impossibile e
    // scrivere sarebbe cieco. (E' anche il primo boot, dove il login che sta
    // per arrivare scrivera' comunque un catalogo aggiornato.)
    credentials() {
      return [
        join(this.shareDir(), 'credentials', 'kimi-code.json'),
        join(this.shareDir(), 'kimi.json'),
      ];
    },
    probeEnv() {
      return { KIMI_SHARE_DIR: this.shareDir(), KIMI_CLI_NO_AUTO_UPDATE: '1' };
    },
    // Esattamente l'invocazione provata a mano sulla macchina il 2026-07-28:
    //   kimi --model kimi-code/k3 --quiet -p "rispondi solo: ok"  → exit 0, "ok"
    // Il prompt e' una frase e non una parola sola: fra le ipotesi sul falso
    // negativo c'era anche il turno di una parola sola, e non c'e' motivo di
    // discostarsi da cio' che sul campo ha risposto.
    probeArgs(cfg, alias) {
      return ['--config-file', cfg, '--model', alias, '--quiet', '-p', 'rispondi solo: ok'];
    },
  },
  codex: {
    bin: 'codex',
    mutable: false,
    defaultKey: 'model',
    tableParent: null,
    configPath: () => join(JHT_HOME, '.codex', 'config.toml'),
    detectOnlyReason:
      'il suo config non elenca le alternative (non c\'e\' un catalogo da cui scegliere, e un nome '
      + 'inventato lascerebbe la CLI con un pin che non risolve), e lo stesso file contiene le '
      + 'entry trust_level degli agenti',
  },
  claude: {
    bin: 'claude',
    applicable: false,
    notApplicableReason:
      'start-agent.sh passa --model opus|sonnet a ogni spawn (l\'argomento vince sul config) '
      + 'e gli alias seguono la generazione corrente: nessun pin da rivedere',
  },
};

// ── Stato fra un boot e l'altro ─────────────────────────────────────────────
// Serve a non spammare: un container che riparte dieci volte non deve
// consegnare dieci volte lo stesso finding al Capitano. La SCRITTURA invece si
// ripete volentieri — se la CLI rimette il default del piano a ogni login,
// ri-affermare la scelta a ogni boot e' proprio la cura.
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

/** Backup PRIMA di toccare un file che non e' nostro. Se fallisce, non si scrive. */
function makeBackup(path) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const backup = `${path}.bak-model-pin-${stamp}`;
  const original = statSync(path);
  copyFileSync(path, backup);
  if (!existsSync(backup) || statSync(backup).size !== original.size) {
    throw new Error(`backup incompleto (${backup})`);
  }
  return { backup, mode: original.mode & 0o7777 };
}

/** Scrittura atomica: temp + rename, cosi' un'interruzione non tronca il config. */
function atomicWrite(path, text, mode) {
  const tmp = `${path}.jht-model-pin.tmp`;
  writeFileSync(tmp, text, 'utf-8');
  try { chmodSync(tmp, mode); } catch { /* fs senza permessi POSIX */ }
  renameSync(tmp, path);
}

/** Tiene i KEEP_BACKUPS piu' recenti: i .bak non devono accumularsi a ogni boot. */
function pruneBackups(path, log) {
  try {
    const dir = dirname(path);
    const prefix = `${basename(path)}.bak-model-pin-`;
    const olds = readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
    for (const f of olds.slice(0, Math.max(0, olds.length - KEEP_BACKUPS))) {
      unlinkSync(join(dir, f));
      log(`${MP} backup vecchio rimosso: ${f}`);
    }
  } catch { /* la potatura non e' mai un motivo per fallire */ }
}

// ── Passo di boot ───────────────────────────────────────────────────────────

/**
 * Nota operativa che accompagna OGNI finding: gli agenti leggono il modello
 * all'AVVIO della sessione. Al boot il passo gira prima degli spawn, quindi li'
 * e' coperto — ma chi lancia `jht providers model-pin` su un team vivo non vede
 * cambiare niente finche' le sessioni non ripartono, e senza questa riga crede
 * che non abbia funzionato.
 */
const RESTART_NOTE =
  'Nota: gli agenti leggono il modello all\'AVVIO della sessione. Al boot il cambio e\' gia\' attivo '
  + '(questo passo gira prima degli spawn); su un team gia\' vivo il modello nuovo entra in uso solo '
  + 'dopo un riavvio delle sessioni.';

/**
 * Rivede il pin di modello del provider attivo: legge il catalogo che il config
 * gia' elenca, sceglie il candidato migliore, lo PROVA e — solo se risponde —
 * lo scrive. NON LANCIA MAI: qualunque errore diventa un log e il boot
 * prosegue, come il resto del ticket.
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
  const catalog = readModelCatalog(text, spec.tableParent);
  log(pin
    ? `${MP} ${target}: pin corrente ${describePin(pin)} (${configPath})`
    : `${MP} ${target}: nessun ${spec.defaultKey} in ${configPath} — la CLI ricade sul default del piano`);

  const state = readState();
  const signature = `${target}|${pin?.model ?? '-'}|${ctxOf(pin?.caps)}`;
  const sameAsLast = (outcome, detail) =>
    !!state && state.signature === signature && state.outcome === outcome && state.detail === detail;
  const finish = (outcome, detail) => {
    writeState({ ts: new Date().toISOString(), provider: target, signature, outcome, detail });
    return { outcome, detail };
  };
  // Un finding per situazione, non per riavvio.
  const report = (msg, outcome, detail) => {
    if (sameAsLast(outcome, detail)) {
      log(`${MP} finding gia' consegnato per questa situazione (${outcome}) — non lo ripeto`);
      return;
    }
    if (notifyCaptain?.(msg)) log(`${MP} finding consegnato al Capitano (mailbox bridge)`);
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
    if (!pin) {
      log(`${MP} ${target}: nessun pin — la CLI usa il suo default`);
      return finish('NO_PIN');
    }
    log(`${MP} ${target}: rilevato ma NON modificabile — ${spec.detectOnlyReason}`);
    report([
      `📌 [FINDING] Il config di ${target} contiene un pin di modello: ${describePin(pin)} (${configPath}).`,
      'JHT non lo tocca da solo:',
      `${spec.detectOnlyReason}.`,
      'Finche\' resta li\', quel modello e\' quello che il team usa anche se il provider ne ha promosso uno piu\' recente:',
      'cambiarlo altera costo, comportamento e finestra di contesto, quindi e\' una decisione dell\'utente — portagliela.',
      RESTART_NOTE,
    ].join(' '), 'DETECT_ONLY', pin.model);
    return finish('DETECT_ONLY', pin.model);
  }

  // 3. Il catalogo e' la risposta dell'account: senza, non c'e' niente fra cui
  //    scegliere, e inventarsi un alias e' il modo migliore di fermare il team.
  if (catalog.length === 0) {
    log(`${MP} ${target}: il config non elenca nessun [${spec.tableParent}."…"] — nessuna alternativa fra cui scegliere`);
    return finish('NO_CATALOG', pin?.model);
  }
  log(`${MP} ${target}: alias elencati dal config → ${catalog.map((m) => `${m.alias} (ctx ${ctxOf(m.caps) || '?'})`).join(', ')}`);

  // 4. Senza credenziali la CLI non puo' rispondere: provare e' impossibile.
  const creds = spec.credentials?.() ?? [];
  if (creds.length > 0 && !creds.some((p) => existsSync(p))) {
    log(`${MP} ${target}: credenziali assenti (${creds.join(', ')}) — verifica impossibile, pin intatto`);
    return finish('NO_CREDENTIALS', pin?.model);
  }

  // 5. Scelta: la finestra dichiarata dal file, non il nome.
  const candidates = rankCandidates(catalog, pin);
  if (candidates.length === 0) {
    log(`${MP} ${target}: nessun alias con finestra piu' ampia di quella attuale (${ctxOf(pin?.caps) || 'sconosciuta'}) — niente da promuovere`);
    return finish('NO_BETTER_CANDIDATE', pin?.model);
  }

  // 6. Prova prima di scrivere. Se il migliore non risponde si scende al
  //    successivo invece di rinunciare: un candidato bocciato non dice niente
  //    sugli altri.
  const failures = [];
  let chosen = null;
  let probe = null;
  for (const cand of candidates) {
    const res = probeCandidate(spec, text, cand.alias, log);
    if (res.ok) { chosen = cand; probe = res; break; }
    log(`${MP} ${target}: candidato scartato — ${res.reason}`);
    failures.push(res.reason);
  }

  if (!chosen) {
    log(`${MP} ${target}: nessun candidato ha risposto — pin lasciato com'e'`);
    report([
      `⚠️ [FINDING] Modello NON promosso (${target}): resta ${pin ? describePin(pin) : `senza ${spec.defaultKey}`}.`,
      `Il config elenca alias con una finestra piu' ampia (${candidates.map((c) => `${c.alias} ctx ${ctxOf(c.caps)}`).join(', ')}),`,
      `ma alla prova non ha risposto nessuno: ${failures.join(' | ')}.`,
      'Non scrivo un modello che non ha risposto: un team su un modello vecchio e\' enormemente meglio di un team fermo.',
      `Per rifare la prova a mano: \`jht providers model-pin --dry-run\` (config: ${configPath}).`,
    ].join(' '), 'PROBE_FAILED', candidates[0].alias);
    return finish('PROBE_FAILED', candidates[0].alias);
  }

  if (dryRun) {
    log(`${MP} ${target}: [dry-run] scriverei ${spec.defaultKey} = "${chosen.alias}" (${describeModel(chosen.alias, chosen.caps)}) — verificato con: ${probe.via}`);
    return { outcome: 'WOULD_PROMOTE', detail: chosen.alias };
  }

  // 7. Solo ora si scrive. Backup prima, scrittura atomica dopo.
  let backup;
  try {
    const bk = makeBackup(configPath);
    backup = bk.backup;
    const note = `# ${new Date().toISOString().slice(0, 10)} JHT [PROVIDER-MODEL-PIN]: ${spec.defaultKey}`
      + ` ${pin ? `"${pin.model}" (ctx ${ctxOf(pin.caps) || '?'})` : '(assente)'} → "${chosen.alias}" (ctx ${ctxOf(chosen.caps) || '?'}),`
      + ` scelto fra gli alias elencati qui sotto e verificato con un turno reale. Backup: ${basename(backup)}`;
    atomicWrite(configPath, setDefaultModel(text, spec, chosen.alias, note), bk.mode);
    log(`${MP} backup: ${backup}`);
    pruneBackups(configPath, log);
  } catch (err) {
    log(`${MP} ${target}: riscrittura ANNULLATA (${err.message}) — pin intatto`);
    return finish('WRITE_FAILED', err.message);
  }

  const from = pin ? describePin(pin) : `(nessun ${spec.defaultKey})`;
  log(`${MP} ${target}: modello PROMOSSO — ${from} → ${describeModel(chosen.alias, chosen.caps)} (verificato con: ${probe.via} → "${probe.answer}")`);
  report([
    `🔄 [FINDING] Modello promosso al boot (${target}): ${from} → ${describeModel(chosen.alias, chosen.caps)}.`,
    'Il valore vecchio lo aveva scritto la CLI al primo login e non lo rivedeva piu\': congelava il modello E la finestra',
    'di contesto (e\' la finestra contro cui gli agenti si sono bloccati).',
    `Scelto fra gli alias che il config gia' elencava (${catalog.map((m) => `${m.alias} ctx ${ctxOf(m.caps) || '?'}`).join(', ')}),`,
    'in base alla finestra dichiarata — non al nome — e PROVATO prima di scriverlo: ha risposto a un turno reale.',
    `Backup: ${backup} — per tornare indietro: \`cp ${backup} ${configPath}\` e riavvia le sessioni.`,
    'Un cambio di modello altera costo, comportamento e finestra: l\'utente deve saperlo, anche quando e\' desiderato — portaglielo.',
    RESTART_NOTE,
  ].join(' '), 'PROMOTED', chosen.alias);
  return finish('PROMOTED', chosen.alias);
}

// Esportati per i test / diagnostica.
export const __internals = { readPin, readModelCatalog, rankCandidates, setDefaultModel, PIN_SPECS, deliberatePin };
