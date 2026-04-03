import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerConfigCommand } from './commands/config.js';
import { registerStatusCommand } from './commands/status.js';
import { registerTeamCommand } from './commands/team/index.js';
import { registerCronCommand } from './commands/cron.js';

export function buildProgram() {
  const program = new Command();

  program
    .name('jht')
    .description('Job Hunter Team — CLI')
    .version('0.1.0');

  registerSetupCommand(program);
  registerConfigCommand(program);
  registerStatusCommand(program);
  registerTeamCommand(program);
  registerCronCommand(program);

  return program;
}
