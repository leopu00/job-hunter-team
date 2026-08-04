// Registrazione comando team con sottocomandi
import { Command } from 'commander';
import { listAction, statusAction } from './list.js';
import { startAction } from './start.js';
import { stopAction } from './stop.js';

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

  program.addCommand(team);
}
