// Comandi `jht ticket` e `jht directives` — i verbi di DECISIONE dell'utente
//
// Fino al 2026-07-25 il CLI sapeva leggere (`positions`, `stats`, `status`) e
// comandare il team (`team start/stop/send/chat`), ma non decidere: aprire un
// ticket su una posizione o dare un ordine permanente al Capitano si poteva
// fare solo dal browser o dall'ufficio Godot. Chi guida JHT da uno script — o
// un agente LLM, che è il pubblico dichiarato in
// docs/guides/AI-AGENT-INTEGRATION.md — restava tagliato fuori.
// Vedi [JHT-CLI-AGENT-PARITY] nel BACKLOG.
//
// Qui NON c'è logica di dominio: le regole vivono nelle skill Python
// (`ticket.py`, `team_directives.py`), che sono già il single-writer per il
// team. Questo file passa gli argomenti ed eredita l'exit code, così un agente
// può verificare l'esito senza leggere il testo dell'output.

import { Command } from 'commander';
import { runSkill } from './positions.js';

// L'esito si posa su `process.exitCode` e si lascia terminare il processo da
// solo. Con `process.exit()` l'uscita era immediata, e l'output della skill —
// che `runSkill` scrive con `process.stdout.write` quando passa dal container —
// poteva restare in un buffer di pipe mai drenato: l'agente che legge il JSON
// riceveva una riga tagliata a metà. Vedi [CLI-NO-GLOBAL-ERROR-HANDLER].
const run = (skill, args) => { process.exitCode = runSkill(skill, args); };

export function registerTicketCommand(program) {
  const cmd = new Command('ticket')
    .description('Send user tickets about a position to the team (proxy to ticket.py)');

  cmd
    .command('open <position_id> <text>')
    .description('Open a ticket for the Capitano')
    .option('--kind <type>', 'ticket category', 'custom')
    .action((positionId, text, options) =>
      run('ticket.py', ['open', String(positionId), text, '--kind', options.kind]));

  cmd
    .command('list')
    .description('List open tickets for the Capitano')
    .action(() => run('ticket.py', ['list-open']));

  cmd
    .command('count')
    .description('Print only the number of open tickets (stable script output)')
    .action(() => run('ticket.py', ['count-open']));

  cmd
    .command('show <id>')
    .description('Detail of a ticket')
    .action((id) => run('ticket.py', ['show', String(id)]));

  cmd
    .command('for-position <position_id>')
    .description('List all tickets for a position')
    .action((id) => run('ticket.py', ['for-position', String(id)]));

  // assign/resolve sono operazioni del TEAM, non dell'utente: restano
  // raggiungibili perché un agente che guida JHT può doverle usare, ma non
  // sono in cima all'help — il flusso normale è open → il team fa il resto.
  cmd
    .command('assign <id> <agent>')
    .description('[team] Assign a ticket to an agent')
    .action((id, agent) => run('ticket.py', ['assign', String(id), agent]));

  cmd
    .command('resolve <id>')
    .description('[team] Close a ticket with an answer for the user')
    .requiredOption('--response <text>', 'the answer that the user will read')
    .action((id, options) =>
      run('ticket.py', ['resolve', String(id), '--response', options.response]));

  program.addCommand(cmd);
}

export function registerFeedbackCommand(program) {
  const cmd = new Command('feedback')
    .description('Read the judgements the user gave on positions (proxy to feedback_query.py)');

  // La scrittura è arrivata il 2026-08-10, con l'autorizzazione esplicita
  // dell'operatore: fino a quel giorno la route rispondeva 403 a un token di
  // dispositivo, e un `set` qui sarebbe stato un comando che esiste e
  // fallisce. Il perché della rimozione sta in cima alla POST di
  // `web/app/api/positions/[legacyId]/feedback/route.ts`.
  //
  // UN SOLO verbo di scrittura, `set`: like/dislike/hide/star/clear sono
  // VALORI dell'azione, non comandi separati. Sei sottocomandi sarebbero sei
  // superfici da autorizzare invece di una.
  cmd
    .command('set <legacy_id> <action>')
    .description('Record the user judgement: like | dislike | hide | star | clear')
    .option('--reason <text>', 'short reason (max 500 chars)')
    .option('--comment <text>', 'free text (max 2000 chars)')
    .option('--score <n>', 'rating from 1 to 5')
    .option('--direction <dir>', 'more_like_this | less_like_this')
    .action((legacyId, action, options) => {
      const args = ['set', String(legacyId), String(action)];
      for (const [flag, value] of [['--reason', options.reason],
        ['--comment', options.comment], ['--score', options.score],
        ['--direction', options.direction]]) {
        if (value !== undefined) args.push(flag, String(value));
      }
      run('feedback_record.py', args);
    });

  cmd
    .command('check <legacy_id>')
    .description('The most recent judgement on a position (null when there is none)')
    .action((legacyId) => run('feedback_query.py', ['check', String(legacyId)]));

  cmd
    .command('recent')
    .description('Feedback events across all positions in a time window')
    .option('--days <n>', 'window in days (0 = all)', '30')
    .option('--limit <n>', 'maximum events read from the cloud', '500')
    .action((options) =>
      run('feedback_query.py', ['recent', '--days', options.days, '--limit', options.limit]));

  cmd
    .command('themes')
    .description('Recurring reasons, grouped from what the user wrote')
    .option('--days <n>', 'window in days (0 = all)', '30')
    .option('--min-positions <n>', 'discard themes below N distinct positions', '3')
    .action((options) =>
      run('feedback_query.py',
        ['themes', '--days', options.days, '--min-positions', options.minPositions]));

  program.addCommand(cmd);
}

export function registerDirectivesCommand(program) {
  const cmd = new Command('directives')
    .description('Board: persistent team directives (proxy to team_directives.py)');

  // `jht directives` da solo = le direttive attive: è la domanda che uno si fa
  // il 90% delle volte ("cosa ho ordinato al team?").
  cmd.action(() => run('team_directives.py', ['active']));

  cmd
    .command('list')
    .description('List active directives')
    .option('--all', 'include archived directives')
    .action((options) =>
      run('team_directives.py', options.all ? ['list', '--all'] : ['list']));

  cmd
    .command('add <text>')
    .description('Add a directive that remains valid until archived')
    .option('--kind <type>', 'order | strategy | formation | note', 'order')
    .option('--by <author>', 'user | capitano | assistente', 'user')
    .action((body, options) =>
      run('team_directives.py', ['add', body, '--kind', options.kind, '--by', options.by]));

  cmd
    .command('edit <id> <text>')
    .description('Rewrite the body of a directive')
    .action((id, body) => run('team_directives.py', ['edit', String(id), body]));

  cmd
    .command('archive <id>')
    .description('Retract a directive (the team stops applying it)')
    .action((id) => run('team_directives.py', ['archive', String(id)]));

  cmd
    .command('show <id>')
    .description('Detail of a directive')
    .action((id) => run('team_directives.py', ['show', String(id)]));

  program.addCommand(cmd);
}
