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
import { registerLogsCommand } from './commands/logs.js';
import { registerProvidersCommand } from './commands/providers.js';
import { registerStatsCommand } from './commands/stats.js';
import { registerPluginsCommand } from './commands/plugins.js';
import { registerAgentsCommand } from './commands/agents.js';
import { registerNotificationsCommand } from './commands/notifications.js';
import { registerSessionsCommand } from './commands/sessions.js';
import { registerTemplatesCommand } from './commands/templates.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerResetCommand } from './commands/reset.js';
import { registerUpgradeCommand } from './commands/upgrade.js';
import { registerDashboardCommand } from './commands/dashboard.js';
import { registerContextCommand } from './commands/context.js';
import { registerSecretsCommand } from './commands/secrets.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerReportCommand } from './commands/report.js';
import { registerWebhooksCommand } from './commands/webhooks.js';

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
  registerLogsCommand(program);
  registerProvidersCommand(program);
  registerStatsCommand(program);
  registerPluginsCommand(program);
  registerAgentsCommand(program);
  registerNotificationsCommand(program);
  registerSessionsCommand(program);
  registerTemplatesCommand(program);
  registerDoctorCommand(program);
  registerResetCommand(program);
  registerUpgradeCommand(program);
  registerDashboardCommand(program);
  registerContextCommand(program);
  registerSecretsCommand(program);
  registerHooksCommand(program);
  registerReportCommand(program);
  registerWebhooksCommand(program);

  return program;
}
