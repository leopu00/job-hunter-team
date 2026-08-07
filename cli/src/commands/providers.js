import { readFile, writeFile, access } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';
import { refreshModelPin } from './model-pin.js';
import { isContainer } from '../../../shared/runtime/container.js';
import { c, GREEN, YELLOW, DIM, RESET } from './_colors.js';
import { Command } from 'commander';

const JHT_DIR     = JHT_HOME;
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json');
const CREDS_DIR   = join(JHT_DIR, 'credentials');

const KNOWN_PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY', aliases: ['claude'] },
  openai:    { name: 'OpenAI (Codex)',     envKey: 'OPENAI_API_KEY',    aliases: ['codex'] },
  kimi:      { name: 'Kimi K2 (Moonshot)', envKey: 'MOONSHOT_API_KEY',  aliases: ['moonshot'] },
};

/**
 * Normalizza l'ID provider per scrittura in jht.config.json:
 *   - codex       → openai    (start-agent.sh fa case openai, non codex)
 *   - moonshot    → kimi      (start-agent.sh fa case kimi|moonshot)
 *   - claude      → claude    (lasciato intatto: web/syncJhtConfig scrive claude)
 *   - anthropic   → anthropic (anch'esso accettato dal launcher)
 *   - openai/kimi → se stesso
 *   - valori ignoti → null (rifiuto)
 */
function normalizeId(id) {
  const lower = (id || '').trim().toLowerCase();
  const ALIASES = { codex: 'openai', moonshot: 'kimi' };
  if (ALIASES[lower]) return ALIASES[lower];
  if (KNOWN_PROVIDERS[lower]) return lower;
  if (lower === 'claude') return 'claude';
  return null;
}

const OK = c.green('●');
const WARN = c.yellow('◐');
const ERR = c.red('✗');

// ── Version detection ───────────────────────────────────────────────────────
// Specchio di web/app/api/providers/route.ts. I path risolvono dal HOST
// grazie al bind-mount ~/.jht ↔ /jht_home: i CLI installati nel container
// vivono nella stessa dir vista dal host, così non serve docker exec.
const NPM_GLOBAL = join(JHT_DIR, '.npm-global', 'lib', 'node_modules');
const VERSION_SOURCES = {
  anthropic: {
    kind: 'npm',
    pkgJson: join(NPM_GLOBAL, '@anthropic-ai', 'claude-code', 'package.json'),
  },
  openai: {
    kind: 'npm',
    pkgJson: join(NPM_GLOBAL, '@openai', 'codex', 'package.json'),
    latestJson: join(JHT_DIR, '.codex', 'version.json'),  // codex scrive latest_version qui
  },
  kimi: {
    kind: 'uv',
    distInfoParent: join(JHT_DIR, '.local', 'share', 'uv', 'tools', 'kimi-cli', 'lib', 'python3.13', 'site-packages'),
    distInfoPrefix: 'kimi_cli-',
  },
};

function readJsonSafe(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

function readUvToolVersion(parentDir, prefix) {
  try {
    for (const name of readdirSync(parentDir)) {
      if (!name.startsWith(prefix) || !name.endsWith('.dist-info')) continue;
      const m = name.match(new RegExp(`^${prefix}(.+)\\.dist-info$`));
      if (m) return m[1];
    }
  } catch { /* dir assente */ }
  return null;
}

function getVersionInfo(providerId) {
  const src = VERSION_SOURCES[providerId];
  if (!src) return { installed: null, latest: null };
  if (src.kind === 'npm') {
    const pkg = readJsonSafe(src.pkgJson);
    const latestJson = src.latestJson ? readJsonSafe(src.latestJson) : null;
    return { installed: pkg?.version ?? null, latest: latestJson?.latest_version ?? null };
  }
  return { installed: readUvToolVersion(src.distInfoParent, src.distInfoPrefix), latest: null };
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function handleProviders() {
  console.log('\n  JHT — Provider LLM\n');

  let config = {};
  if (await fileExists(CONFIG_PATH)) {
    try { config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8')); } catch { /* skip */ }
  }

  const activeProvider = config.active_provider ?? null;
  const providers = config.providers ?? {};

  for (const [id, known] of Object.entries(KNOWN_PROVIDERS)) {
    const provCfg = providers[id];
    const hasConfig = !!provCfg;
    const hasEnv = !!process.env[known.envKey];
    const hasCred = await fileExists(join(CREDS_DIR, `${id}.enc`)) || await fileExists(join(CREDS_DIR, `${id}.json`));
    const isActive = activeProvider === id;

    const authMethod = provCfg?.auth_method ?? (hasEnv ? 'env' : hasCred ? 'file' : 'none');
    const model = provCfg?.model ?? '—';
    const icon = hasConfig && (hasEnv || hasCred || provCfg?.api_key) ? OK : hasConfig ? WARN : ERR;
    const activeLabel = isActive ? ` ${GREEN}[ACTIVE]${RESET}` : '';

    console.log(`  ${icon}  ${known.name}${activeLabel}`);
    console.log(`     ${DIM}ID: ${id} · Model: ${model} · Auth: ${authMethod}${RESET}`);
    if (hasEnv) console.log(`     ${DIM}Env: ${known.envKey} ✓${RESET}`);
    if (hasCred) console.log(`     ${DIM}Credentials: encrypted file ✓${RESET}`);
    const ver = getVersionInfo(id);
    if (ver.installed || ver.latest) {
      const updateAvail = !!(ver.installed && ver.latest && ver.installed !== ver.latest);
      let line = `     ${DIM}CLI: ${ver.installed || '—'}`;
      if (updateAvail) line += ` ${YELLOW}→ ${ver.latest} ⚠ update available${RESET}${DIM}`;
      line += RESET;
      console.log(line);
    }
    console.log('');
  }

  // Provider aggiuntivi non noti
  const custom = Object.keys(providers).filter(k => !KNOWN_PROVIDERS[k]);
  if (custom.length > 0) {
    console.log(`  ${DIM}Provider custom:${RESET}`);
    for (const id of custom) {
      const p = providers[id];
      const isActive = activeProvider === id;
      const activeLabel = isActive ? ` ${GREEN}[ACTIVE]${RESET}` : '';
      console.log(`  ${WARN}  ${id}${activeLabel} — model: ${p?.model ?? '—'}`);
    }
    console.log('');
  }

  if (!activeProvider) {
    console.log(`  ${DIM}No active providers. Configure with: jht config set active_provider <id>${RESET}\n`);
  }
}

async function handleUse(id) {
  const normalized = normalizeId(id);
  if (!normalized) {
    console.error(`${ERR}  provider '${id}' unrecognized. Supported: ${Object.keys(KNOWN_PROVIDERS).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  let config = {};
  if (await fileExists(CONFIG_PATH)) {
    try { config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8')); } catch { /* start fresh */ }
  }
  const prev = config.active_provider;
  config.active_provider = normalized;
  // Inserisci stub provider config se mancante (default subscription)
  config.providers = config.providers || {};
  if (!config.providers[normalized]) {
    config.providers[normalized] = { auth_method: 'subscription' };
  }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  if (prev === normalized) {
    console.log(`  ${OK} provider already active: ${normalized}`);
  } else {
    console.log(`  ${OK} active provider: ${prev || '(Nothing)'} → ${normalized}`);
    console.log(`  ${DIM}Reboot team to apply: jht team stop --all && jht team start${RESET}`);
  }
}

// Spec di upgrade per ciascun provider. Consumata anche dal setup nativo Godot.
// (stessa semantica, ma forziamo sempre install anche se già presente). Per
// ogni provider: lista di step, ogni step diventa `docker compose run --rm
// --no-deps --entrypoint <entrypoint> jht <args>` — eseguito in un container
// effimero, così rename() atomici di npm non trovano il binario in uso.
// Il prefisso lo decide il compose (che lo tiene FUORI dal bind-mount: su
// Windows scriverci costa ~158x). Qui si rispetta quello che il container
// dichiara, col vecchio percorso come fallback per i runtime piu' datati.
const NPM_PREFIX = process.env.NPM_CONFIG_PREFIX || '/jht_home/.npm-global';
const UV_BIN_DIR = process.env.UV_TOOL_BIN_DIR || `${NPM_PREFIX}/bin`;
const PY_USER_BASE = '/opt/jht-deps/python';
const NPM_PREFIX_ENV = { NPM_CONFIG_PREFIX: NPM_PREFIX };
const UPDATE_SPECS = {
  claude: [{ entrypoint: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code@latest'], env: NPM_PREFIX_ENV }],
  codex:  [{ entrypoint: 'npm', args: ['install', '-g', '@openai/codex@latest'], env: NPM_PREFIX_ENV }],
  // Kimi: uv reinstall è il flusso "update". --force ricrea il venv e pinna
  // l'ultima versione pubblicata. Lo stesso step di install (senza `uv tool
  // uninstall kimi-cli` prima, che fallirebbe se assente).
  kimi: [{
    entrypoint: 'sh',
    args: ['-c', [
      'set -e',
      // uv finisce nel prefisso veloce SOLO per questa installazione: il
      // PYTHONUSERBASE globale resta il magazzino condiviso degli agenti
      // (RULE-T13), che non c'entra con i CLI dei provider.
      `export PYTHONUSERBASE=${PY_USER_BASE}`,
      `export PATH="${PY_USER_BASE}/bin:$HOME/.local/bin:$PATH"`,
      'pip3 install --user --break-system-packages --upgrade uv',
      `UV_TOOL_BIN_DIR=${UV_BIN_DIR} uv tool install --force --python 3.13 kimi-cli`,
    ].join(' && ')],
  }],
};

// Tetto duro per singolo step di update in-container. npm e uv non hanno un
// timeout globale: un registry che accetta la connessione e poi tace terrebbe
// in ostaggio chi li aspetta — e da quando l'update gira al boot (pid1) chi
// aspetta e' il container intero. Scaduto il tempo, lo step viene ucciso e si
// prosegue con la CLI gia' presente.
const UPDATE_STEP_TIMEOUT_MS =
  (Number(process.env.JHT_PROVIDER_UPDATE_TIMEOUT_SEC) || 300) * 1000;

function resolveUpdateTarget(id) {
  // Accept user-facing aliases/normalised IDs and map to update spec keys
  // (claude/codex/kimi). Mantiene gli stessi id mostrati nel gioco.
  const lower = (id || '').trim().toLowerCase();
  if (lower === 'anthropic' || lower === 'claude') return 'claude';
  if (lower === 'openai' || lower === 'codex') return 'codex';
  if (lower === 'kimi' || lower === 'moonshot') return 'kimi';
  return null;
}

function findRepoRoot(startDir = process.cwd()) {
  // Cerca docker-compose.yml in ordine di precedenza:
  //   1. JHT_COMPOSE_FILE (set dal wrapper bash su VPS / utenti install.sh)
  //   2. ~/.jht/runtime/ (default install.sh Docker-mode dal 2026-05-06)
  //   3. risalendo dal CWD (path "from source", contributor)
  // L'update DEVE girare dalla dir che contiene il compose del container jht,
  // altrimenti `docker compose run` non trova il servizio.
  if (process.env.JHT_COMPOSE_FILE) {
    const dir = resolve(process.env.JHT_COMPOSE_FILE, '..');
    if (existsSync(join(dir, 'docker-compose.yml'))) return dir;
  }
  const runtimeDir = process.env.JHT_RUNTIME_DIR || join(homedir(), '.jht', 'runtime');
  if (existsSync(join(runtimeDir, 'docker-compose.yml'))) return runtimeDir;

  let dir = resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'docker-compose.yml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function handleUpdate(id) {
  const targets = id
    ? [resolveUpdateTarget(id)].filter(Boolean)
    : Object.keys(UPDATE_SPECS); // `jht providers update` senza arg → aggiorna tutti

  if (targets.length === 0) {
    console.error(`${ERR}  provider '${id}' unrecognized. Supported: claude, codex, kimi`);
    process.exitCode = 1;
    return;
  }

  // Branch in-container vs host:
  // - Sul container (isContainer(), path Docker via wrapper bash) non c'e'
  //   docker daemon: eseguiamo i comandi npm/uv direttamente. L'install
  //   scrive nei prefissi su /opt/jht-deps (volume Docker dal 2026-07-26,
  //   prima era il bind-mount /jht_home/.npm-global), quindi persiste
  //   cross-container e cross-restart.
  // - Sull'host (path "from source", contributor) usiamo docker compose run
  //   per ottenere un container effimero isolato (evita rename collisions
  //   sui binari npm in uso dal container running).
  if (isContainer()) {
    const res = await handleUpdateInContainer(targets);
    if (!res.ok) {
      process.exitCode = 1;
      return;
    }
    console.log(`\n  ${DIM}Reboot agents to load the new version: jht team stop --all && jht team start${RESET}\n`);
    return;
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot || !existsSync(join(repoRoot, 'docker-compose.yml'))) {
    console.error(`${ERR}  docker-compose.yml not found. Run from the root of the JHT repo.`);
    process.exitCode = 1;
    return;
  }

  const homeDir = homedir();
  const dockerEnv = { ...process.env, HOME: homeDir, MSYS_NO_PATHCONV: '1' };

  let failed = 0;
  for (const target of targets) {
    const steps = UPDATE_SPECS[target];
    console.log(`\n  ${DIM}── Updating ${target} ──${RESET}`);
    for (const step of steps) {
      const args = ['compose', 'run', '--rm', '--no-deps', '--entrypoint', step.entrypoint];
      for (const [k, v] of Object.entries(step.env || {})) {
        args.push('-e', `${k}=${v}`);
      }
      args.push('jht', ...step.args);
      console.log(`  ${DIM}$ docker ${args.join(' ')}${RESET}`);
      const r = spawnSync('docker', args, { cwd: repoRoot, stdio: 'inherit', env: dockerEnv });
      if (r.status !== 0) {
        console.error(`  ${ERR}  failed step (exit ${r.status}) for ${target}`);
        failed++;
        break;
      }
    }
    if (!failed) console.log(`  ${OK}  ${target} updated`);
  }

  // `return` esplicito: con `process.exit()` bastava segnare il codice per
  // fermare tutto, con `process.exitCode` il flusso prosegue — e senza il
  // `return` il consiglio "riavvia gli agenti" verrebbe stampato proprio a chi
  // l'aggiornamento e' fallito. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
  if (failed > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ${DIM}Reboot agents to load the new version: jht team stop --all && jht team start${RESET}\n`);
}

/**
 * Un singolo step, con tetto di tempo che vale davvero.
 *
 * `detached: true` da' al figlio un process group tutto suo, cosi' allo
 * scadere del timeout si uccide il GRUPPO: lo step di kimi e' un `sh -c 'a &&
 * b'` e chi resta appeso alla rete e' un NIPOTE — ammazzare la sola shell lo
 * lascerebbe vivo a scrivere nel prefisso mentre il team parte (e chi aspetta
 * resterebbe fermo lo stesso). Il rovescio del detached e' che il Ctrl-C del
 * terminale non raggiunge piu' il figlio da solo: lo si inoltra a mano finche'
 * lo step e' in corso.
 */
function runUpdateStep(step, timeoutMs) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(step.env || {}) };
    let child;
    try {
      child = spawn(step.entrypoint, step.args, { stdio: 'inherit', env, detached: true });
    } catch (error) {
      resolve({ status: null, error, timedOut: false });
      return;
    }
    let timedOut = false;
    const killGroup = (sig) => {
      try { process.kill(-child.pid, sig); } catch { /* gruppo gia' morto */ }
    };
    const timer = setTimeout(() => { timedOut = true; killGroup('SIGKILL'); }, timeoutMs);
    const forward = (sig) => killGroup(sig);
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    const done = (res) => {
      clearTimeout(timer);
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
      resolve(res);
    };
    child.on('error', (error) => done({ status: null, error, timedOut }));
    child.on('exit', (status, signal) => done({ status, signal, timedOut }));
  });
}

/**
 * Esegue gli step di update DENTRO al container. Unico percorso di install:
 * lo riusa sia `jht providers update` (umano) sia l'auto-update al boot.
 *
 * NON esce dal processo: ritorna `{ ok, failed[], reason }` e lascia decidere
 * al chiamante. Il comando interattivo traduce !ok in `exit 1`; l'auto-update
 * al boot NON puo' permetterselo — un update fallito non deve impedire al team
 * di lavorare (vincolo fail-safe di [PROVIDER-CLI-AUTOUPDATE]).
 *
 * Persistenza: npm scrive in $NPM_CONFIG_PREFIX e uv in $UV_TOOL_DIR, entrambi
 * su /opt/jht-deps (volume Docker) — quindi l'installazione sopravvive al
 * riavvio del container e al secondo boot non c'e' nulla da reinstallare.
 */
async function handleUpdateInContainer(targets) {
  const failed = [];
  let reason = '';
  for (const target of targets) {
    const steps = UPDATE_SPECS[target];
    console.log(`\n  ${DIM}── Updating ${target} (in-container) ──${RESET}`);
    let targetFailed = false;
    for (const step of steps) {
      console.log(`  ${DIM}$ ${step.entrypoint} ${step.args.join(' ')}${RESET}`);
      const r = await runUpdateStep(step, UPDATE_STEP_TIMEOUT_MS);
      if (r.status !== 0) {
        // Tre esiti da tenere distinti nel messaggio, perche' portano a tre
        // diagnosi diverse: binario assente, tempo scaduto, exit code.
        reason = r.timedOut
          ? `${step.entrypoint} killed after ${UPDATE_STEP_TIMEOUT_MS / 1000}s (timeout)`
          : r.error
            ? `${step.entrypoint}: ${r.error.message}`
            : r.signal
              ? `${step.entrypoint} killed by ${r.signal}`
              : `${step.entrypoint} exit ${r.status}`;
        console.error(`  ${ERR}  failed step (${reason}) for ${target}`);
        targetFailed = true;
        break;
      }
    }
    if (targetFailed) failed.push(target);
    else console.log(`  ${OK}  ${target} updated`);
  }
  return { ok: failed.length === 0, failed, reason };
}

// ── Auto-update al boot del container ───────────────────────────────────────
// [PROVIDER-CLI-AUTOUPDATE] `jht providers update` funziona, ma si aggiorna
// solo se un umano se lo ricorda: una VPS in produzione e' rimasta undici
// giorni indietro e due agenti si sono impantanati a 565k e 168k token contro
// una finestra da 262k, quando la versione piu' recente ne offriva una da 1M.
// Qui l'aggiornamento diventa un passo del boot — pid1 lo esegue PRIMA dei
// bridge e quindi prima che esista qualunque cosa che usi la CLI.
//
// Tre proprieta' non negoziabili:
//   • FAIL-SAFE. Qualunque esito, exit 0: rete assente, registry irraggiungibile,
//     versione rotta → si logga e si parte con la CLI gia' presente. Un
//     aggiornamento non riuscito non puo' impedire al team di lavorare.
//   • SOLO IL PROVIDER ATTIVO. Aggiornare tutti e tre a ogni boot e' banda e
//     tempo sprecati per due CLI che nessuno lancera'.
//   • NON SCEGLIE IL MODELLO. L'update riguarda la CLI: JHT non passa un
//     modello a kimi/codex e non ne applica uno nuovo di sua iniziativa. Ogni
//     cambio arriva al Capitano come FINDING, perche' cambia costi,
//     comportamento e finestra di contesto.
//     ATTENZIONE, e' la lezione dei due test in campo: "non toccare il
//     modello" non voleva dire "non toccare niente". La CLI si scrive un PIN al
//     primo login e non lo rivede mai piu', quindi lasciarlo intatto NON e'
//     neutrale — inchioda il team alla generazione del giorno del login e alla
//     finestra di contesto di allora. Il passo di refreshModelPin() (in fondo
//     ad autoUpdateOnce) sceglie fra gli alias che il config del provider GIA'
//     elenca, in base alla finestra dichiarata, e lo scrive SOLO dopo avergli
//     chiesto di rispondere davvero. Non cancella sperando che la CLI si
//     aggiorni da sola: provato il 2026-07-28, la CLI riscrive il vecchio
//     alias perche' e' il default del piano. Dettagli in model-pin.js.
const AU = '[provider-autoupdate]';

// Binario di ciascuna CLI, come lo invoca .launcher/start-agent.sh.
const UPDATE_BIN = { claude: 'claude', codex: 'codex', kimi: 'kimi' };
const UPDATE_NPM_PKG = { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' };
const SEMVER_RE = /(\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?)/;

/**
 * Versione della CLI chiedendola AL BINARIO. E' la misura che conta: e' lo
 * stesso eseguibile che gli agenti trovano sul PATH, quindi non dipende da
 * dove npm/uv abbiano deciso di scrivere (prefisso cambiato il 2026-07-26 da
 * /jht_home/.npm-global a /opt/jht-deps, e il vecchio resta nel PATH).
 *   claude --version → "2.1.220 (Claude Code)"
 *   codex  --version → "codex-cli 0.145.0"
 *   kimi   --version → "kimi, version 1.36.0"
 */
function versionFromBinary(target) {
  const bin = UPDATE_BIN[target];
  if (!bin) return null;
  try {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf-8', timeout: 20_000 });
    if (r.status !== 0) return null;
    const m = SEMVER_RE.exec(`${r.stdout || ''}\n${r.stderr || ''}`);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Fallback su disco quando il binario non e' installato o non risponde. */
function versionFromDisk(target) {
  const pkgName = UPDATE_NPM_PKG[target];
  if (pkgName) {
    const roots = [join(NPM_PREFIX, 'lib', 'node_modules'), NPM_GLOBAL];
    for (const root of roots) {
      const pkg = readJsonSafe(join(root, ...pkgName.split('/'), 'package.json'));
      if (pkg?.version) return pkg.version;
    }
    return null;
  }
  // kimi: venv di uv, layout <tool-dir>/kimi-cli/lib/<pythonX.Y>/site-packages.
  // La minor di Python non e' fissa (oggi 3.13, domani no): si scandisce.
  const toolDirs = [
    process.env.UV_TOOL_DIR,
    join(JHT_DIR, '.local', 'share', 'uv', 'tools'),
  ].filter(Boolean);
  for (const toolDir of toolDirs) {
    let pythons = [];
    try { pythons = readdirSync(join(toolDir, 'kimi-cli', 'lib')); } catch { continue; }
    for (const py of pythons) {
      const v = readUvToolVersion(join(toolDir, 'kimi-cli', 'lib', py, 'site-packages'), 'kimi_cli-');
      if (v) return v;
    }
  }
  return null;
}

function detectInstalledVersion(target) {
  return versionFromBinary(target) ?? versionFromDisk(target);
}

/**
 * Per i provider npm, chiedere la versione pubblicata costa molto meno di un
 * `npm install -g` no-op e non riscrive migliaia di file nel volume Docker.
 * Se il registry non risponde o restituisce un formato inatteso si torna al
 * percorso fail-safe storico: tentare l'installazione vera.
 */
function versionFromNpmRegistry(target) {
  const pkgName = UPDATE_NPM_PKG[target];
  if (!pkgName) return null;
  const timeout = (Number(process.env.JHT_PROVIDER_VERSION_CHECK_TIMEOUT_SEC) || 15) * 1000;
  try {
    const r = spawnSync('npm', ['view', `${pkgName}@latest`, 'version'], {
      encoding: 'utf-8',
      timeout,
      env: { ...process.env, ...NPM_PREFIX_ENV },
    });
    if (r.status !== 0 || r.error) return null;
    const m = SEMVER_RE.exec(`${r.stdout || ''}\n${r.stderr || ''}`);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Provider attivo + modello dichiarato in jht.config.json. */
async function readActiveProvider() {
  if (!(await fileExists(CONFIG_PATH))) return { id: null, model: null };
  try {
    const config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    const id = config.active_provider ?? null;
    const model = (id && config.providers?.[id]?.model) || null;
    return { id, model };
  } catch {
    return { id: null, model: null };
  }
}

/**
 * Consegna un finding al Capitano appendendolo alla mailbox JSONL che gia'
 * usano sentinel-bridge e pacing-bridge ($JHT_HOME/logs/bridge-mailbox.jsonl):
 * il Capitano la svuota all'inizio di OGNI turno con la skill `bridge-mailbox`.
 *
 * Non si usa `jht-tmux-send`: al boot la sessione CAPITANO non esiste ancora
 * (gli agenti partono dopo), quindi il messaggio andrebbe perso proprio nel
 * momento in cui vale di piu'. La mailbox e' asincrona per costruzione.
 */
function appendCaptainFinding(msg) {
  try {
    const logsDir = join(JHT_DIR, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      kind: 'provider-cli',
      delivered_via_tmux: false,
      msg,
    };
    appendFileSync(join(logsDir, 'bridge-mailbox.jsonl'), JSON.stringify(entry) + '\n', 'utf-8');
    return true;
  } catch (err) {
    console.error(`${AU} finding not delivered to Capitano: ${err.message}`);
    return false;
  }
}

/** `JHT_PROVIDER_AUTOUPDATE=0|false|off|no` spegne l'auto-update. Default: acceso. */
function autoUpdateDisabled() {
  const raw = (process.env.JHT_PROVIDER_AUTOUPDATE ?? '').trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'off' || raw === 'no';
}

async function autoUpdateOnce() {
  if (autoUpdateDisabled()) {
    console.log(`${AU} disabled (JHT_PROVIDER_AUTOUPDATE=${process.env.JHT_PROVIDER_AUTOUPDATE}): no update attempt`);
    return;
  }
  if (!isContainer()) {
    console.log(`${AU} skip: outside the container. From the host, run 'jht providers update <id>'`);
    return;
  }

  const active = await readActiveProvider();
  if (!active.id) {
    console.log(`${AU} skip: active_provider not yet configured (${CONFIG_PATH}) — nothing to update`);
    return;
  }
  const target = resolveUpdateTarget(active.id);
  if (!target) {
    console.log(`${AU} skip: active provider '${active.id}' has no update spec (supported: claude, codex, kimi)`);
    return;
  }

  const before = detectInstalledVersion(target);
  console.log(`${AU} active provider '${active.id}' → target ${target} (installed: ${before ?? 'unknown'})`);

  const published = versionFromNpmRegistry(target);
  const alreadyLatest = !!before && !!published && before === published;
  let res;
  if (alreadyLatest) {
    console.log(`${AU} ${target}: registry ${published}, installation skipped (already current)`);
    res = { ok: true, failed: [], reason: '', skipped: true };
  } else {
    if (published) console.log(`${AU} ${target}: registry ${published}, installation required`);
    res = await handleUpdateInContainer([target]);
  }
  const after = detectInstalledVersion(target);

  // Criterio 2: il log dice SEMPRE prima → dopo, e dice esplicitamente quando
  // non e' cambiato niente. Un log che tace sul no-op non permette di
  // distinguere "gia' aggiornata" da "non ha girato".
  const b = before ?? 'unknown';
  const a = after ?? 'unknown';
  const changed = !!before && !!after && before !== after;
  let verdict;
  if (changed) {
    verdict = res.ok
      ? 'UPDATED'
      : 'UPDATED (the step reported an error, but the version changed)';
  } else if (res.ok) {
    verdict = 'UNCHANGED — already at the latest version; nothing to reinstall';
  } else {
    verdict = `UNCHANGED — update FAILED (${res.reason || 'unknown cause'}); the team will use the existing CLI`;
  }
  console.log(`${AU} ${target}: ${b} → ${a} — ${verdict}`);

  if (changed) {
    // La CLI e' cambiata: qui si segnala e basta. Il Capitano lo legge al primo
    // drain della mailbox e lo porta all'utente, che decide.
    const modelLine = active.model
      ? `\`${active.model}\` (from jht.config.json)`
      : 'the provider default (not pinned in jht.config.json)';
    const finding = [
      `🔄 [FINDING] Provider CLI updated at boot: ${target} ${b} → ${a}.`,
      `The MODEL was NOT changed: it remains ${modelLine}.`,
      'If this CLI version exposes a newer model, changing it is a USER DECISION',
      '(it affects cost, behavior, and context window): bring it to the user; do not apply it automatically.',
    ].join(' ');
    if (appendCaptainFinding(finding)) {
      console.log(`${AU} finding delivered to the Capitano (mailbox bridge, drain at the beginning of shift)`);
    }
  }

  // [PROVIDER-MODEL-PIN] Aggiornare la CLI non sposta il modello: la CLI si
  // scrive un pin al primo login e non lo rivede mai piu' (il test in campo del
  // 2026-07-28 ha trovato la CLI all'ultima versione e il team su una
  // generazione precedente, con la finestra di contesto congelata a 262k).
  // Il passo gira SEMPRE, non solo quando la versione e' cambiata: il pin e'
  // vecchio anche — soprattutto — quando non c'e' niente da aggiornare.
  // E gira anche a ogni riavvio successivo: se la CLI rimette il default del
  // piano al login, ri-affermare la scelta e' esattamente cio' che serve.
  //
  // Qui e non altrove: dopo l'update (la CLI che fa la verifica dev'essere
  // quella nuova) e prima che pid1 spawni qualunque agente, perche' il pin
  // viene letto all'avvio di ogni sessione.
  await refreshModelPin({ target, notifyCaptain: appendCaptainFinding });
}

/**
 * [PROVIDER-MODEL-PIN] Stesso passo, invocabile a mano: serve per verificare in
 * campo cosa farebbe (o perche' non fa niente) senza riavviare il container.
 * Fuori dal container degrada a dry-run: `~/.jht/.kimi` appartiene all'utente
 * del container (uid 1001) e non si riscrive dall'host.
 */
async function handleModelPin(opts = {}) {
  const active = await readActiveProvider();
  const target = resolveUpdateTarget(active.id);
  if (!target) {
    console.log(`${AU} no active provider with pin spec (active_provider=${active.id ?? '(Nothing)'})`);
    return;
  }
  let dryRun = !!opts.dryRun;
  if (!dryRun && !isContainer()) {
    console.log(`${AU} outside the container: continuing in dry-run mode (the provider config belongs to the container user)`);
    dryRun = true;
  }
  await refreshModelPin({ target, notifyCaptain: appendCaptainFinding, dryRun });
}

/**
 * Entry point del boot. Non fallisce MAI: qualunque eccezione viene loggata e
 * il processo esce 0, perche' pid1 non deve avere motivo di fermarsi qui.
 */
async function handleAutoUpdate() {
  try {
    await autoUpdateOnce();
  } catch (err) {
    console.error(`${AU} unexpected error: ${err?.message ?? err} — continue with the CLI already present`);
  }
}

// Scriptable: stampa "id installed_version latest_version" per ogni provider
// con update disponibile. Exit 0 se nessuno, exit 1 se almeno uno.
async function handleCheck() {
  const updates = [];
  for (const id of Object.keys(VERSION_SOURCES)) {
    const ver = getVersionInfo(id);
    if (ver.installed && ver.latest && ver.installed !== ver.latest) {
      updates.push({ id, installed: ver.installed, latest: ver.latest });
    }
  }
  if (updates.length === 0) {
    console.log(`${OK} all providers are up to date`);
    return;
  }
  for (const u of updates) {
    console.log(`${u.id} ${u.installed} ${u.latest}`);
  }
  // Exit 1 = "c'e' almeno un update", ed e' il contratto scriptabile di questo
  // comando: chi lo chiama legge PRIMA le righe e POI il codice. Con
  // `process.exit()` subito dopo il ciclo di `console.log`, su una pipe quelle
  // righe potevano restare nel buffer — il codice diceva "ci sono update" e
  // l'output non diceva quali. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
  process.exitCode = 1;
}

async function handleCurrent() {
  if (!(await fileExists(CONFIG_PATH))) {
    console.log(`  ${DIM}(No config)${RESET}`);
    return;
  }
  try {
    const config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    console.log(config.active_provider ?? '(Nothing)');
  } catch {
    console.log('(invalid)');
  }
}

export function registerProvidersCommand(program) {
  const cmd = new Command('providers').description('Provider LLM — list / current / use');

  // Default action: list (back-compat con `jht providers`)
  cmd.action(handleProviders);

  cmd
    .command('list')
    .description('Show configured providers + auth status')
    .action(handleProviders);

  cmd
    .command('current')
    .description('Print the active provider (one-liner, scriptable)')
    .action(handleCurrent);

  cmd
    .command('use <id>')
    .description('Set the active provider (`jht config set active_provider` alias)')
    .action(handleUse);

  cmd
    .command('update [id]')
    .description('Update the provider\'s CLI (claude/codex/kimi) to the latest version. Omitted id: updates all supported providers.')
    .action(handleUpdate);

  cmd
    .command('autoupdate')
    .description('Update the CLI of the active SOLO provider and review the model pin written to the login (boot pass: fail-safe, never fails). Switchable with JHT_PROVIDER_AUTOUPDATE=0.')
    .action(handleAutoUpdate);

  cmd
    .command('model-pin')
    .description('It reveals the pinnate model from the CLI to the login: it chooses between the aliases that the config already lists (wider window), test it and only then writes it. JHT_MODEL_PIN=<x> blocks it.')
    .option('--dry-run', 'report what would be done without writing anything')
    .action((opts) => handleModelPin(opts));

  cmd
    .command('check')
    .description('Show providers with updates available (scriptable; exit 1 if any)')
    .action(handleCheck);

  program.addCommand(cmd);
}
