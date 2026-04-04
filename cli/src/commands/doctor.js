import { readFile, access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const JHT_DIR     = join(homedir(), '.jht');
const CONFIG_PATH = join(JHT_DIR, 'jht.config.json');

const OK   = '\x1b[32m✓\x1b[0m';
const WARN = '\x1b[33m!\x1b[0m';
const ERR  = '\x1b[31m✗\x1b[0m';
const DIM  = '\x1b[90m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function cmdExists(cmd) {
  try { execSync(`which ${cmd} 2>/dev/null`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

function cmdVersion(cmd) {
  try { return execSync(`${cmd} --version 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0]; }
  catch { return null; }
}

async function checkConfig() {
  if (!(await fileExists(CONFIG_PATH))) return { icon: ERR, msg: 'jht.config.json non trovato', hint: 'Esegui: jht setup' };
  try {
    const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    const v = cfg.version ?? 1;
    if (v < 4) return { icon: WARN, msg: `Config v${v} — aggiornamento disponibile`, hint: 'Esegui: jht migrate' };
    return { icon: OK, msg: `Config v${v} valida` };
  } catch { return { icon: ERR, msg: 'Config JSON non valido' }; }
}

async function checkProvider() {
  if (!(await fileExists(CONFIG_PATH))) return { icon: ERR, msg: 'Nessun provider — config mancante' };
  try {
    const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    const active = cfg.active_provider;
    if (!active) return { icon: WARN, msg: 'Nessun provider attivo', hint: 'Esegui: jht config set active_provider anthropic' };
    const prov = cfg.providers?.[active];
    const hasKey = prov?.api_key || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    if (!hasKey && prov?.auth_method !== 'cli') return { icon: WARN, msg: `Provider ${active} senza API key`, hint: `Imposta ${active.toUpperCase()}_API_KEY in .env` };
    return { icon: OK, msg: `Provider: ${active} (${prov?.model ?? 'default'})` };
  } catch { return { icon: ERR, msg: 'Errore lettura config provider' }; }
}

async function checkTelegram() {
  if (!(await fileExists(CONFIG_PATH))) return { icon: DIM + '—' + RESET, msg: 'Telegram — config mancante' };
  try {
    const cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    if (!cfg.channels?.telegram?.bot_token) return { icon: DIM + '—' + RESET, msg: 'Telegram non configurato', hint: 'Opzionale — configura in jht.config.json' };
    return { icon: OK, msg: 'Telegram configurato' };
  } catch { return { icon: DIM + '—' + RESET, msg: 'Telegram — errore lettura config' }; }
}

function checkDependencies() {
  const deps = [
    { cmd: 'node', required: true },
    { cmd: 'npm', required: true },
    { cmd: 'tmux', required: true },
    { cmd: 'claude', required: false },
    { cmd: 'git', required: true },
    { cmd: 'pandoc', required: false },
    { cmd: 'typst', required: false },
  ];
  const results = [];
  for (const d of deps) {
    const exists = cmdExists(d.cmd);
    const version = exists ? cmdVersion(d.cmd) : null;
    if (exists) {
      results.push({ icon: OK, msg: `${d.cmd}: ${version ?? 'trovato'}` });
    } else if (d.required) {
      results.push({ icon: ERR, msg: `${d.cmd}: non trovato`, hint: `Installa ${d.cmd}` });
    } else {
      results.push({ icon: DIM + '—' + RESET, msg: `${d.cmd}: non trovato (opzionale)` });
    }
  }
  return results;
}

async function checkPermissions() {
  const checks = [
    { path: JHT_DIR, label: '~/.jht/' },
    { path: join(JHT_DIR, 'tasks'), label: '~/.jht/tasks/' },
    { path: join(JHT_DIR, 'sessions'), label: '~/.jht/sessions/' },
  ];
  const results = [];
  for (const c of checks) {
    if (!(await fileExists(c.path))) {
      results.push({ icon: WARN, msg: `${c.label} non esiste`, hint: 'Verrà creata automaticamente' });
      continue;
    }
    try {
      const s = await stat(c.path);
      const mode = '0' + (s.mode & 0o777).toString(8);
      results.push({ icon: OK, msg: `${c.label} (${mode})` });
    } catch { results.push({ icon: ERR, msg: `${c.label} — errore accesso` }); }
  }
  return results;
}

async function handleDoctor() {
  console.log(`\n  ${BOLD}JHT — Doctor${RESET}\n`);

  const sections = [
    { title: 'Configurazione', checks: [await checkConfig()] },
    { title: 'Provider LLM', checks: [await checkProvider()] },
    { title: 'Telegram', checks: [await checkTelegram()] },
    { title: 'Dipendenze', checks: checkDependencies() },
    { title: 'Permessi', checks: await checkPermissions() },
  ];

  let errors = 0, warnings = 0;
  for (const s of sections) {
    console.log(`  ${BOLD}${s.title}${RESET}`);
    for (const c of s.checks) {
      console.log(`    ${c.icon}  ${c.msg}`);
      if (c.hint) console.log(`       ${DIM}↳ ${c.hint}${RESET}`);
      if (c.icon === ERR) errors++;
      if (c.icon === WARN) warnings++;
    }
    console.log('');
  }

  if (errors > 0) console.log(`  \x1b[31m${errors} errori da risolvere.\x1b[0m\n`);
  else if (warnings > 0) console.log(`  \x1b[33m${warnings} avvisi — sistema funzionante con limitazioni.\x1b[0m\n`);
  else console.log(`  \x1b[32mTutto OK — sistema pronto.\x1b[0m\n`);
}

export function registerDoctorCommand(program) {
  program
    .command('doctor')
    .description('Verifica setup completo — config, provider, dipendenze, permessi')
    .action(handleDoctor);
}
