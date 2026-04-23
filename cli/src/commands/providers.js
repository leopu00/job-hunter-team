import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
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
const RESET = '\x1b[0m';

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

  program.addCommand(cmd);
}
