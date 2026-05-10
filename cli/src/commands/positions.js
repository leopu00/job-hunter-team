// Comando positions — proxy verso db_query.py del container
//
// Legge direttamente dalla SQLite (jobs.db) tramite lo skill Python
// che il team usa gia'. Consistenti con la web UI /positions perche'
// entrambi puntano allo stesso jobs.db via bind-mount.
//
// Sottocomandi:
//   jht positions list [--status X] [--company Y] [--min-score N] [--source Z]
//   jht positions show <id|legacy_id>
//   jht positions dashboard      riepilogo aggregato (stesso di db_query.py dashboard)
//
// Il comando proxia al container se up, altrimenti prova sul DB host
// (bind-mount path stessi).

import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { containerRunning, execInContainer, CONTAINER_NAME } from '../utils/container-proxy.js';
import { JHT_DB_PATH } from '../jht-paths.js';

const SKILL_PATH_CONTAINER = '/app/shared/skills/db_query.py';

const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

/** Esegue lo skill db_query.py (container o host) e passa l'output. */
function runDbQuery(args) {
  if (containerRunning()) {
    // Build shell cmd con escape sicuro degli args (single-quote)
    const escaped = args.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ');
    const cmd = `python3 ${SKILL_PATH_CONTAINER} ${escaped}`;
    const r = execInContainer(cmd, { timeoutMs: 30_000 });
    process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.code ?? 1;
  }
  // Fallback host: richiede che il repo e Python siano presenti localmente
  // e che jobs.db sia accessibile. Tipicamente su Linux/Mac dev locale.
  const r = spawnSync('python3', ['shared/skills/db_query.py', ...args], {
    stdio: 'inherit',
    env: { ...process.env, JHT_DB: JHT_DB_PATH },
  });
  return r.status ?? 1;
}

function listAction(options = {}) {
  const args = ['positions'];
  if (options.status) args.push('--status', options.status);
  if (options.company) args.push('--company', options.company);
  if (options.minScore) args.push('--min-score', String(options.minScore));
  if (options.maxScore) args.push('--max-score', String(options.maxScore));
  if (options.source) args.push('--source', options.source);
  const code = runDbQuery(args);
  if (code !== 0) process.exit(code);
}

function showAction(id) {
  if (!id) {
    console.error(c.red('Uso: jht positions show <id|legacy_id>'));
    process.exit(1);
  }
  const code = runDbQuery(['position', String(id)]);
  if (code !== 0) process.exit(code);
}

function dashboardAction() {
  const code = runDbQuery(['dashboard']);
  if (code !== 0) process.exit(code);
}

export function registerPositionsCommand(program) {
  const cmd = new Command('positions').description('Query DB posizioni (proxy a db_query.py)');

  cmd.action(() => listAction({})); // default: jht positions → list all

  cmd
    .command('list')
    .description('Elenca posizioni con filtri opzionali')
    .option('-s, --status <status>', 'filtro stato (new, checked, scored, writing, review, ready, applied, response, excluded)')
    .option('-c, --company <name>', 'filtro azienda')
    .option('--min-score <n>', 'score minimo')
    .option('--max-score <n>', 'score massimo')
    .option('--source <src>', 'filtro fonte (linkedin, greenhouse, lever, ashby, pythonjobs, websearch, careerpages)')
    .action(listAction);

  cmd
    .command('show <id>')
    .description('Mostra dettaglio di una posizione (id UUID o legacy_id numerico)')
    .action(showAction);

  cmd
    .command('dashboard')
    .description('Riepilogo pipeline (totali per stato)')
    .action(dashboardAction);

  program.addCommand(cmd);
}
