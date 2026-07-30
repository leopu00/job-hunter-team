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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { containerRunning, execArgvInContainer, CONTAINER_NAME } from '../utils/container-proxy.js';
import { JHT_DB_PATH } from '../jht-paths.js';
import { c } from './_colors.js';

/**
 * Esegue una skill Python di shared/skills (container se attivo, host altrimenti).
 *
 * Il container resta la strada preferita: è lì che vive il jobs.db su cui
 * lavora il team, e ci arriva col bind-mount. Il fallback host serve allo
 * sviluppo locale e alle macchine senza container su.
 */
export function runSkill(skill, args) {
  if (containerRunning()) {
    // Argomenti separati, senza shell: includono testo libero scritto
    // dall'utente (note di esclusione, corpo di una direttiva, risposta a un
    // ticket), e per un apice o un `$` non esiste più una stringa da cui
    // uscire.
    const r = execArgvInContainer(['python3', `/app/shared/skills/${skill}`, ...args.map(String)], {
      timeoutMs: 30_000,
    });
    process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.code ?? 1;
  }
  // Fuori dal container la skill va cercata sul disco: se non c'è, il fallimento
  // deve essere un messaggio del prodotto — chi legge `python3: can't open file`
  // non ha modo di capire che gli manca il codice del team, non Python.
  const skillPath = join(SKILLS_DIR, skill);
  if (!existsSync(skillPath)) {
    console.error(c.red(`✗ skill non trovata: ${skillPath}`));
    console.error(c.dim(
      `  Serve il container ${CONTAINER_NAME} attivo (jht team start) oppure una copia`,
    ));
    console.error(c.dim('  completa del repo: questo comando gira sulle skill in shared/skills/.'));
    return 2;
  }
  const r = spawnSync('python3', [skillPath, ...args], {
    stdio: 'inherit',
    env: { ...process.env, JHT_DB: JHT_DB_PATH },
  });
  if (r.error) {
    console.error(c.red(`✗ impossibile eseguire python3: ${r.error.message}`));
    return 2;
  }
  return r.status ?? 1;
}

const runDbQuery = (args) => runSkill('db_query.py', args);

/**
 * Legge le opzioni tenendo conto del comando padre.
 *
 * `--json` è dichiarato sia su `positions` che su ogni sottocomando, così
 * compare in entrambi gli `--help`. Ma commander 13, quando lo stesso flag
 * esiste ai due livelli, lo assegna al PADRE: `cmd.opts()` dentro l'azione di
 * `list` torna `{}` anche con `--json` scritto dopo `list` (verificato il
 * 2026-07-25 — il flag veniva accettato e ignorato in silenzio, che è il modo
 * peggiore di fallire). `optsWithGlobals()` unisce i due livelli e copre tutte
 * le forme: `positions --json`, `positions list --json`, `positions show 1 --json`.
 */
function opts(options, command) {
  return command?.optsWithGlobals ? command.optsWithGlobals() : (options || {});
}

function listAction(options, command) {
  const o = opts(options, command);
  const args = ['positions'];
  if (o.status) args.push('--status', o.status);
  if (o.company) args.push('--company', o.company);
  if (o.minScore) args.push('--min-score', String(o.minScore));
  if (o.maxScore) args.push('--max-score', String(o.maxScore));
  if (o.source) args.push('--source', o.source);
  if (o.json) args.push('--json');
  const code = runDbQuery(args);
  if (code !== 0) process.exit(code);
}

function showAction(id, options, command) {
  if (!id) {
    console.error(c.red('Uso: jht positions show <id|legacy_id>'));
    process.exit(1);
  }
  const args = ['position', String(id)];
  if (opts(options, command).json) args.push('--json');
  const code = runDbQuery(args);
  if (code !== 0) process.exit(code);
}

function dashboardAction(options, command) {
  const args = ['dashboard'];
  if (opts(options, command).json) args.push('--json');
  const code = runDbQuery(args);
  if (code !== 0) process.exit(code);
}

// ── Verbi di DECISIONE ────────────────────────────────────────────────
//
// Fino al 2026-07-25 `jht positions` sapeva solo leggere: ogni azione che
// esprime un giudizio dell'utente — escludere, chiedere il CV — esisteva solo
// nella UI. Chi guida JHT da script o da un agente LLM poteva guardare e
// comandare il team, ma non decidere nulla. Vedi [JHT-CLI-AGENT-PARITY].
//
// Le skill sottostanti restano la fonte: qui non c'è logica di dominio, solo
// il passaggio degli argomenti. Ogni verbo stampa la riga JSON della skill ed
// eredita il suo exit code (0 ok / 1 rifiutato), così è verificabile in uno
// script senza leggere il testo.

function excludeAction(id, options) {
  const args = ['exclude', String(id), '--reason', options.reason];
  if (options.note) args.push('--note', options.note);
  process.exit(runSkill('user_exclude.py', args));
}

function restoreAction(id) {
  process.exit(runSkill('user_exclude.py', ['restore', String(id)]));
}

function requestCvAction(id, options) {
  process.exit(runSkill('write_request.py', [
    String(id), '--mode', options.off ? 'off' : 'on',
  ]));
}

export function registerPositionsCommand(program) {
  const cmd = new Command('positions').description('Query DB posizioni (proxy a db_query.py)');

  // `--json` su ogni lettura: il default resta la tabella per l'occhio umano,
  // il flag dà la stessa query come una riga JSON. Serve a chi guida `jht` da
  // uno script o da un agente LLM, che altrimenti deve estrarre i dati a
  // regex da colonne allineate a mano — vedi [JHT-CLI-AGENT-PARITY].
  const JSON_HELP = 'output JSON (per script e agenti)';

  cmd
    .option('--json', JSON_HELP)
    .action(listAction); // default: jht positions → list all

  cmd
    .command('list')
    .description('Elenca posizioni con filtri opzionali')
    .option('-s, --status <status>', 'filtro stato (new, checked, scored, writing, review, ready, applied, response, excluded)')
    .option('-c, --company <name>', 'filtro azienda')
    .option('--min-score <n>', 'score minimo')
    .option('--max-score <n>', 'score massimo')
    .option('--source <src>', 'filtro fonte (linkedin, greenhouse, lever, ashby, pythonjobs, websearch, careerpages)')
    .option('--json', JSON_HELP)
    .action(listAction);

  cmd
    .command('show <id>')
    .description('Mostra dettaglio di una posizione (id UUID o legacy_id numerico)')
    .option('--json', JSON_HELP)
    .action(showAction);

  cmd
    .command('dashboard')
    .description('Riepilogo pipeline (totali per stato)')
    .option('--json', JSON_HELP)
    .action(dashboardAction);

  cmd
    .command('exclude <id>')
    .description('Escludi una posizione: esce dalle code agenti (reversibile)')
    .requiredOption(
      '--reason <causa>',
      'closed | not_interested | mismatch | already_applied | company | conditions | other',
    )
    .option('--note <testo>', "richiesta con --reason other")
    .action(excludeAction);

  cmd
    .command('restore <id>')
    .description('Annulla un\'esclusione: la posizione torna allo stato precedente')
    .action(restoreAction);

  cmd
    .command('request-cv <id>')
    .description('Chiedi al team di scrivere il CV per questa posizione')
    .option('--off', 'annulla la richiesta invece di farla')
    .action(requestCvAction);

  program.addCommand(cmd);
}
