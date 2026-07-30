import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const JHT_DIR     = join(homedir(), '.jht');
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json');
const CREDS_DIR   = join(JHT_DIR, 'credentials');

const KNOWN_PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY' },
  openai:    { name: 'OpenAI',             envKey: 'OPENAI_API_KEY' },
  minimax:   { name: 'Minimax',            envKey: 'MINIMAX_API_KEY' },
};

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

export function registerProvidersCommand(program) {
  program
    .command('providers')
    .description('Mostra provider LLM configurati e stato autenticazione')
    .action(handleProviders);
}
