import { readFile, writeFile, access } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { JHT_HOME } from '../jht-paths.js';
import { Command } from 'commander';

const JHT_DIR     = JHT_HOME;
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json');
const CREDS_DIR   = join(JHT_DIR, 'credentials');

const KNOWN_PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY', aliases: ['claude'] },
  openai:    { name: 'OpenAI (Codex)',     envKey: 'OPENAI_API_KEY',    aliases: ['codex'] },
  kimi:      { name: 'Kimi (Moonshot)',    envKey: 'MOONSHOT_API_KEY',  aliases: ['moonshot'] },
  minimax:   { name: 'Minimax',            envKey: 'MINIMAX_API_KEY',   aliases: [] },
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

const OK = '\x1b[32m●\x1b[0m';
const WARN = '\x1b[33m◐\x1b[0m';
const ERR = '\x1b[31m✗\x1b[0m';
const DIM = '\x1b[90m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

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

    const authMethod = provCfg?.auth_method ?? (hasEnv ? 'env' : hasCred ? 'file' : 'nessuna');
    const model = provCfg?.model ?? '—';
    const icon = hasConfig && (hasEnv || hasCred || provCfg?.api_key) ? OK : hasConfig ? WARN : ERR;
    const activeLabel = isActive ? ' \x1b[32m[ATTIVO]\x1b[0m' : '';

    console.log(`  ${icon}  ${known.name}${activeLabel}`);
    console.log(`     ${DIM}ID: ${id} · Modello: ${model} · Auth: ${authMethod}${RESET}`);
    if (hasEnv) console.log(`     ${DIM}Env: ${known.envKey} ✓${RESET}`);
    if (hasCred) console.log(`     ${DIM}Credenziali: file cifrato ✓${RESET}`);
    const ver = getVersionInfo(id);
    if (ver.installed || ver.latest) {
      const updateAvail = !!(ver.installed && ver.latest && ver.installed !== ver.latest);
      let line = `     ${DIM}CLI: ${ver.installed || '—'}`;
      if (updateAvail) line += ` ${YELLOW}→ ${ver.latest} ⚠ update disponibile${RESET}${DIM}`;
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
      const activeLabel = isActive ? ' \x1b[32m[ATTIVO]\x1b[0m' : '';
      console.log(`  ${WARN}  ${id}${activeLabel} — modello: ${p?.model ?? '—'}`);
    }
    console.log('');
  }

  if (!activeProvider) {
    console.log(`  ${DIM}Nessun provider attivo. Configura con: jht config set active_provider <id>${RESET}\n`);
  }
}

async function handleUse(id) {
  const normalized = normalizeId(id);
  if (!normalized) {
    console.error(`${ERR}  provider '${id}' non riconosciuto. Supportati: ${Object.keys(KNOWN_PROVIDERS).join(', ')}`);
    process.exit(1);
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
    console.log(`  ${OK} provider gia' attivo: ${normalized}`);
  } else {
    console.log(`  ${OK} provider attivo: ${prev || '(nessuno)'} → ${normalized}`);
    console.log(`  ${DIM}Riavvia il team per applicare: jht team stop --all && jht team start${RESET}`);
  }
}

// Spec di upgrade per ciascun provider. Allineato con desktop/provider-install.js
// (stessa semantica, ma forziamo sempre install anche se già presente). Per
// ogni provider: lista di step, ogni step diventa `docker compose run --rm
// --no-deps --entrypoint <entrypoint> jht <args>` — eseguito in un container
// effimero, così rename() atomici di npm non trovano il binario in uso.
const NPM_PREFIX_ENV = { NPM_CONFIG_PREFIX: '/jht_home/.npm-global' };
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
      'export PATH="$HOME/.local/bin:$PATH"',
      'pip3 install --user --break-system-packages --upgrade uv',
      'UV_TOOL_BIN_DIR=/jht_home/.npm-global/bin uv tool install --force --python 3.13 kimi-cli',
    ].join(' && ')],
  }],
};

function resolveUpdateTarget(id) {
  // Accept user-facing aliases/normalised IDs and map to update spec keys
  // (claude/codex/kimi). Mirrors normalizeId + desktop/provider-install.js.
  const lower = (id || '').trim().toLowerCase();
  if (lower === 'anthropic' || lower === 'claude') return 'claude';
  if (lower === 'openai' || lower === 'codex') return 'codex';
  if (lower === 'kimi' || lower === 'moonshot') return 'kimi';
  return null;
}

function findRepoRoot(startDir = process.cwd()) {
  // Cerca docker-compose.yml risalendo: l'update DEVE girare dalla root del
  // repo (o dalla dir che contiene il compose del container jht), altrimenti
  // `docker compose run` non trova il servizio.
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
    console.error(`${ERR}  provider '${id}' non riconosciuto. Supportati: claude, codex, kimi`);
    process.exit(1);
  }

  const repoRoot = findRepoRoot();
  if (!repoRoot || !existsSync(join(repoRoot, 'docker-compose.yml'))) {
    console.error(`${ERR}  docker-compose.yml non trovato. Esegui dalla root del repo JHT.`);
    process.exit(1);
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
        console.error(`  ${ERR}  step fallito (exit ${r.status}) per ${target}`);
        failed++;
        break;
      }
    }
    if (!failed) console.log(`  ${OK}  ${target} aggiornato`);
  }

  if (failed > 0) process.exit(1);

  console.log(`\n  ${DIM}Riavvia gli agenti per caricare la nuova versione: jht team stop --all && jht team start${RESET}\n`);
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
    console.log(`${OK} tutti i provider sono aggiornati`);
    return;
  }
  for (const u of updates) {
    console.log(`${u.id} ${u.installed} ${u.latest}`);
  }
  process.exit(1);
}

async function handleCurrent() {
  if (!(await fileExists(CONFIG_PATH))) {
    console.log(`  ${DIM}(nessun config)${RESET}`);
    return;
  }
  try {
    const config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    console.log(config.active_provider ?? '(nessuno)');
  } catch {
    console.log('(config non valido)');
  }
}

export function registerProvidersCommand(program) {
  const cmd = new Command('providers').description('Provider LLM — list / current / use');

  // Default action: list (back-compat con `jht providers`)
  cmd.action(handleProviders);

  cmd
    .command('list')
    .description('Mostra i provider configurati + stato auth')
    .action(handleProviders);

  cmd
    .command('current')
    .description('Stampa il provider attivo (one-liner, scriptable)')
    .action(handleCurrent);

  cmd
    .command('use <id>')
    .description('Imposta il provider attivo (alias di `jht config set active_provider`)')
    .action(handleUse);

  cmd
    .command('update [id]')
    .description('Aggiorna il CLI del provider (claude/codex/kimi) all\'ultima versione. Omesso id: aggiorna tutti i provider supportati.')
    .action(handleUpdate);

  cmd
    .command('check')
    .description('Mostra provider con update disponibili (scriptable, exit 1 se ce ne sono)')
    .action(handleCheck);

  program.addCommand(cmd);
}
