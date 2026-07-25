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

const run = (skill, args) => process.exit(runSkill(skill, args));

export function registerTicketCommand(program) {
  const cmd = new Command('ticket')
    .description('Ticket utente→team su una posizione (proxy a ticket.py)');

  cmd
    .command('open <position_id> <testo>')
    .description('Apri un ticket: la richiesta finisce in coda al Capitano')
    .option('--kind <tipo>', 'categoria del ticket', 'custom')
    .action((positionId, text, options) =>
      run('ticket.py', ['open', String(positionId), text, '--kind', options.kind]));

  cmd
    .command('list')
    .description('Ticket aperti (la coda del Capitano)')
    .action(() => run('ticket.py', ['list-open']));

  cmd
    .command('count')
    .description('Solo il numero di ticket aperti — output stabile per script')
    .action(() => run('ticket.py', ['count-open']));

  cmd
    .command('show <id>')
    .description('Dettaglio di un ticket')
    .action((id) => run('ticket.py', ['show', String(id)]));

  cmd
    .command('for-position <position_id>')
    .description('Tutti i ticket di una posizione')
    .action((id) => run('ticket.py', ['for-position', String(id)]));

  // assign/resolve sono operazioni del TEAM, non dell'utente: restano
  // raggiungibili perché un agente che guida JHT può doverle usare, ma non
  // sono in cima all'help — il flusso normale è open → il team fa il resto.
  cmd
    .command('assign <id> <agente>')
    .description('[team] Assegna un ticket a un agente')
    .action((id, agent) => run('ticket.py', ['assign', String(id), agent]));

  cmd
    .command('resolve <id>')
    .description('[team] Chiudi un ticket con una risposta per l\'utente')
    .requiredOption('--response <testo>', 'la risposta che l\'utente leggerà')
    .action((id, options) =>
      run('ticket.py', ['resolve', String(id), '--response', options.response]));

  program.addCommand(cmd);
}

export function registerDirectivesCommand(program) {
  const cmd = new Command('directives')
    .description('Bacheca: ordini permanenti al team (proxy a team_directives.py)');

  // `jht directives` da solo = le direttive attive: è la domanda che uno si fa
  // il 90% delle volte ("cosa ho ordinato al team?").
  cmd.action(() => run('team_directives.py', ['active']));

  cmd
    .command('list')
    .description('Direttive attive')
    .option('--all', 'includi anche quelle archiviate')
    .action((options) =>
      run('team_directives.py', options.all ? ['list', '--all'] : ['list']));

  cmd
    .command('add <testo>')
    .description('Aggiungi una direttiva: resta valida finché non la archivi')
    .option('--kind <tipo>', 'order | strategy | formation | note', 'order')
    .option('--by <autore>', 'user | capitano | assistente', 'user')
    .action((body, options) =>
      run('team_directives.py', ['add', body, '--kind', options.kind, '--by', options.by]));

  cmd
    .command('edit <id> <testo>')
    .description('Riscrivi il corpo di una direttiva')
    .action((id, body) => run('team_directives.py', ['edit', String(id), body]));

  cmd
    .command('archive <id>')
    .description('Ritira una direttiva (il team smette di applicarla)')
    .action((id) => run('team_directives.py', ['archive', String(id)]));

  cmd
    .command('show <id>')
    .description('Dettaglio di una direttiva')
    .action((id) => run('team_directives.py', ['show', String(id)]));

  program.addCommand(cmd);
}
