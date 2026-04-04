import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerConfigCommand } from './commands/config.js';
import { registerStatusCommand } from './commands/status.js';
import { registerTeamCommand } from './commands/team/index.js';
import { registerCronCommand } from './commands/cron.js';
import { registerExportCommand } from './commands/export.js';
import { registerImportCommand } from './commands/import.js';
import { registerHealthCommand } from './commands/health.js';
import { registerBackupCommand } from './commands/backup.js';
import { registerMigrateCommand } from './commands/migrate.js';
import { registerCacheCommand } from './commands/cache.js';

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
  registerExportCommand(program);
  registerImportCommand(program);
  registerHealthCommand(program);
  registerBackupCommand(program);
  registerMigrateCommand(program);
  registerCacheCommand(program);

  return program;
}
