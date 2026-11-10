// Registrazione comando team con sottocomandi
import { Command } from 'commander';
import { listAction, statusAction } from './list.js';
import { startAction } from './start.js';
import { stopAction } from './stop.js';
import { sendAction, chatAction } from './chat.js';

export function registerTeamCommand(program) {
  const team = new Command('team').description('Manage the Job Hunter Team agents');

  team
    .command('list')
    .description('Show available agents and their status')
    .action(listAction);

  team
    .command('status')
    .description('Show currently active agents')
    .action(statusAction);

  team
    .command('start [agent]')
    .description('Start an agent or default team (e.g. jht team start scout:1)')
    .option('-m, --mode <mode>', 'mode: default or fast', 'default')
    .option('--skip-key-check', 'do not ask glm/kimi whether the API key is accepted before starting (also JHT_SKIP_KEY_CHECK=1)')
    .action(startAction);

  team
    .command('stop [agent]')
    .description('Stop an agent or all agents')
    .option('-a, --all', 'Stop all agents')
    .action(stopAction);

  team
    .command('send <agent> <message>')
    .description('Send one message to an agent (for example, jht team send capitano "pipeline status")')
    .action(sendAction);

  team
    .command('chat <agent>')
    .description('Interactive chat with an agent (REPL)')
    .option('-q, --quiet', 'do not show pane previews after each send')
    .action(chatAction);

  program.addCommand(team);
}
