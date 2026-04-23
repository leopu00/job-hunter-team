// Registrazione comando team con sottocomandi
import { Command } from 'commander';
import { listAction, statusAction } from './list.js';
import { startAction } from './start.js';
import { stopAction } from './stop.js';
import { sendAction, chatAction } from './chat.js';

export function registerTeamCommand(program) {
  const team = new Command('team').description('Gestione team agenti Job Hunter');

  team
    .command('list')
    .description('Mostra agenti disponibili e il loro stato')
    .action(listAction);

  team
    .command('status')
    .description('Mostra agenti attualmente attivi')
    .action(statusAction);

  team
    .command('start [agente]')
    .description('Avvia un agente o il team default (es: jht team start scout:1)')
    .option('-m, --mode <mode>', 'Modalita: default o fast', 'default')
    .action(startAction);

  team
    .command('stop [agente]')
    .description('Ferma un agente o tutti gli agenti')
    .option('-a, --all', 'Ferma tutti gli agenti')
    .action(stopAction);

  team
    .command('send <agente> <messaggio>')
    .description('Manda un singolo messaggio a un agente (es: jht team send capitano "stato pipeline")')
    .action(sendAction);

  team
    .command('chat <agente>')
    .description('Chat interattiva con un agente (REPL)')
    .option('-q, --quiet', 'Non mostrare peek del pane dopo ogni invio')
    .action(chatAction);

  program.addCommand(team);
}
