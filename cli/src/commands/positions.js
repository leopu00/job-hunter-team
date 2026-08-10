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

// Le skill si risolvono dal percorso di QUESTO modulo, mai dalla cwd: il CLI
// e' installato via symlink in $JHT_BIN_DIR, quindi la cwd dell'utente e'
// arbitraria e un path relativo faceva fallire ogni comando fuori dal repo con
// un errore di Python. `fileURLToPath(import.meta.url)` risolve al file reale,
// non al link.
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../shared/skills');

/**
 * Esegue una skill Python di shared/skills (container se attivo, host altrimenti).
 *
 * Il container resta la strada preferita: è lì che vive il jobs.db su cui
 * lavora il team, e ci arriva col bind-mount. Il fallback host serve allo
 * sviluppo locale e alle macchine senza container su.
 */
export function runSkill(skill, args) {
  const r = runSkillCaptured(skill, args);
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.code;
}

/**
 * Come `runSkill`, ma l'output TORNA al chiamante invece di finire a schermo.
 *
 * Serve a chi deve leggere la risposta della skill prima di decidere cosa
 * mostrare: `jht artifact fetch` riceve un JSON con i byte in base64 e deve
 * scriverli in un file, non riversare un PDF nel terminale. `input` passa un
 * contenuto su stdin (l'upload di un documento), `maxBuffer` alza il tetto di
 * stdout per le risposte grandi.
 *
 * Ritorna { code, stdout, stderr }. `code` resta l'exit code della skill: chi
 * chiama lo propaga così com'è, perché è l'unica cosa che un agente può
 * controllare senza leggere il testo.
 */
export function runSkillCaptured(skill, args, { input = null, maxBuffer = null } = {}) {
  if (containerRunning()) {
    // Argomenti separati, senza shell: includono testo libero scritto
    // dall'utente (note di esclusione, corpo di una direttiva, risposta a un
    // ticket), e per un apice o un `$` non esiste più una stringa da cui
    // uscire.
    const r = execArgvInContainer(['python3', `/app/shared/skills/${skill}`, ...args.map(String)], {
      timeoutMs: 30_000,
      input,
      maxBuffer,
    });
    return { code: r.code ?? 1, stdout: r.stdout, stderr: r.stderr };
  }
  // Fuori dal container la skill va cercata sul disco: se non c'è, il fallimento
  // deve essere un messaggio del prodotto — chi legge `python3: can't open file`
  // non ha modo di capire che gli manca il codice del team, non Python.
  const skillPath = join(SKILLS_DIR, skill);
  if (!existsSync(skillPath)) {
    return {
      code: 2,
      stdout: '',
      stderr: [
        c.red(`: skill not found: ${skillPath}`),
        c.dim(`  Need the container ${CONTAINER_NAME} active (jht team start) or a copy`),
        c.dim('  From a complete repository checkout, this command uses the skills in shared/skills/.'),
        '',
      ].join('\n'),
    };
  }
  const r = spawnSync('python3', [skillPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, JHT_DB: JHT_DB_PATH },
    ...(input === null ? {} : { input }),
    ...(maxBuffer === null ? {} : { maxBuffer }),
  });
  if (r.error) {
    return {
      code: 2,
      stdout: '',
      stderr: c.red(`: impossible to run python3: ${r.error.message}`) + '\n',
    };
  }
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
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
  if (code !== 0) process.exitCode = code;
}

function showAction(id, options, command) {
  if (!id) {
    console.error(c.red('Usage: jht positions show <id|legacy_id>'));
    process.exitCode = 1;
    return;
  }
  const args = ['position', String(id)];
  if (opts(options, command).json) args.push('--json');
  const code = runDbQuery(args);
  if (code !== 0) process.exitCode = code;
}

function dashboardAction(options, command) {
  const args = ['dashboard'];
  if (opts(options, command).json) args.push('--json');
  const code = runDbQuery(args);
  if (code !== 0) process.exitCode = code;
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
//
// L'exit code si posa su `process.exitCode`, non su `process.exit()`: quando il
// container è attivo `runSkill` consegna l'output della skill con
// `process.stdout.write`, e su una pipe quella scrittura è asincrona. Un
// `process.exit()` sulla riga dopo tronca la riga JSON che il chiamante sta
// leggendo — cioè proprio il contratto che questi verbi promettono agli script.
// Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].

function excludeAction(id, options) {
  const args = ['exclude', String(id), '--reason', options.reason];
  if (options.note) args.push('--note', options.note);
  process.exitCode = runSkill('user_exclude.py', args);
}

function restoreAction(id) {
  process.exitCode = runSkill('user_exclude.py', ['restore', String(id)]);
}

function requestCvAction(id, options) {
  process.exitCode = runSkill('write_request.py', [
    String(id), '--mode', options.off ? 'off' : 'on',
  ]);
}

export function registerPositionsCommand(program) {
  const cmd = new Command('positions').description('Query DB positions (proxy at db_query.py)');

  // `--json` su ogni lettura: il default resta la tabella per l'occhio umano,
  // il flag dà la stessa query come una riga JSON. Serve a chi guida `jht` da
  // uno script o da un agente LLM, che altrimenti deve estrarre i dati a
  // regex da colonne allineate a mano — vedi [JHT-CLI-AGENT-PARITY].
  const JSON_HELP = 'output JSON (for scripts and agents)';

  cmd
    .option('--json', JSON_HELP)
    .action(listAction); // default: jht positions → list all

  cmd
    .command('list')
    .description('List positions with optional filters')
    .option('-s, --status <status>', 'filter by status (new, checked, scored, writing, review, ready, applied, response, excluded)')
    .option('-c, --company <name>', 'filter by company')
    .option('--min-score <n>', 'minimum score')
    .option('--max-score <n>', 'maximum score')
    .option('--source <src>', 'filter by source (linkedin, greenhouse, lever, ashby, pythonjobs, websearch, careerpages)')
    .option('--json', JSON_HELP)
    .action(listAction);

  cmd
    .command('show <id>')
    .description('Show position details (UUID or numeric legacy_id)')
    .option('--json', JSON_HELP)
    .action(showAction);

  cmd
    .command('dashboard')
    .description('pipeline summary (totals by state)')
    .option('--json', JSON_HELP)
    .action(dashboardAction);

  cmd
    .command('exclude <id>')
    .description('Exclude a position: exit from code agents (reversible)')
    .requiredOption(
      '--reason <reason>',
      'closed | not_interested | mismatch | already_applied | company | conditions | other',
    )
    .option('--note <text>', 'note required with --reason other')
    .action(excludeAction);

  cmd
    .command('restore <id>')
    .description('Cancel an exclusion: the position returns to the previous state')
    .action(restoreAction);

  cmd
    .command('request-cv <id>')
    .description('Ask the team to write the CV for this position')
    .option('--off', 'cancel the request instead of making it')
    .action(requestCvAction);

  program.addCommand(cmd);
}
