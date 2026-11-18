// Registrazione comando team con sottocomandi
import { Command } from 'commander';
import { say } from '../../lib/texts.js';
import { listAction, statusAction } from './list.js';
import { startAction } from './start.js';
import { stopAction } from './stop.js';
import { sendAction, chatAction } from './chat.js';

// `jht team --help` speaks the language of the person, like the screens of the team: the descriptions and also the
// titles commander writes by itself («Usage:», «Options:»…). Set on `team` before its subcommands, which inherit it.
function speakTheHelp(command) {
  const titles = {
    'Usage:': say('team.help.title_usage'),
    'Arguments:': say('team.help.title_arguments'),
    'Options:': say('team.help.title_options'),
    'Global Options:': say('team.help.title_global_options'),
    'Commands:': say('team.help.title_commands'),
  };
  command.configureHelp({ styleTitle: (title) => titles[title] ?? title });
  command.helpOption('-h, --help', say('team.help.help'));
  command.helpCommand('help [command]', say('team.help.help'));
}

export function registerTeamCommand(program) {
  const team = new Command('team').description(say('team.help.description'));
  speakTheHelp(team);

  team
    .command('list')
    .description(say('team.help.list'))
    .action(listAction);

  team
    .command('status')
    .description(say('team.help.status'))
    .action(statusAction);

  // no default on --mode: commander would add an English «(default: "default")»; startAction takes default itself
  team
    .command('start [agent]')
    .description(say('team.help.start'))
    .option('-m, --mode <mode>', say('team.help.start_mode'))
    .option('--skip-key-check', say('team.help.start_skip_key_check'))
    .action(startAction);

  team
    .command('stop [agent]')
    .description(say('team.help.stop'))
    .option('-a, --all', say('team.help.stop_all'))
    .action(stopAction);

  team
    .command('send <agent> <message>')
    .description(say('team.help.send'))
    .action(sendAction);

  team
    .command('chat <agent>')
    .description(say('team.help.chat'))
    .option('-q, --quiet', say('team.help.chat_quiet'))
    .action(chatAction);

  program.addCommand(team);
}
