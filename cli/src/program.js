import pkg from '../package.json' with { type: 'json' };
import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerConfigCommand } from './commands/config.js';
import { registerWorkingHoursCommand } from './commands/working-hours.js';
import { registerStatusCommand } from './commands/status.js';
import { registerTeamCommand } from './commands/team/index.js';
import { registerCronCommand } from './commands/cron.js';
import { registerExportCommand } from './commands/export.js';
import { registerImportCommand } from './commands/import.js';
import { registerHealthCommand } from './commands/health.js';
import { registerBackupCommand } from './commands/backup.js';
import { registerMigrateCommand } from './commands/migrate.js';
import { registerCacheCommand } from './commands/cache.js';
import { registerToolsCommand } from './commands/tools.js';
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
import { registerKeyringCommand } from './commands/keyring.js';
import { registerHooksCommand } from './commands/hooks.js';
import { registerReportCommand } from './commands/report.js';
import { registerWebhooksCommand } from './commands/webhooks.js';
import { registerCloudCommand } from './commands/cloud.js';
import { registerSentinellaCommand } from './commands/sentinella.js';
import { registerContainerCommand } from './commands/container.js';
import { registerPositionsCommand } from './commands/positions.js';
import { registerTicketCommand, registerDirectivesCommand } from './commands/decisions.js';
import { registerProfileCommand } from './commands/profile.js';
import { registerPid1Command } from './commands/pid1.js';

// Help "essenziale" mostrato di default da `jht`, `jht --help`, `jht -h`.
// Per la lista completa di tutti i sotto-comandi (export/import/cron/
// webhooks/secrets/...) l'utente usa `jht help`. Riduce l'attrito post-
// install: VPS fresca → 30+ sotto-comandi spaventano e nascondono i 5
// che servono davvero. Vedi docs/internal/ops/vps.md → "P1 — Help post-install
// troppo lunga".
const ESSENTIAL_HELP = `Usage: jht [command]

Job Hunter Team — CLI

Comandi essenziali:
  setup        Configurazione iniziale (lancia il wizard)
  status       Stato del sistema (container, agenti, db)
  agents       Lista agenti e task in corso
  dashboard    Apri la dashboard web
  doctor       Diagnostica setup e dipendenze

Per la lista completa di tutti i comandi:
  jht help
`;

export function buildProgram() {
  const program = new Command();

  program
    .name('jht')
    .description('Job Hunter Team — CLI')
    .version(pkg.version);

  // Disabilita il sotto-comando `help` auto-generato da commander: lo
  // ridefiniamo sotto per stampare l'help COMPLETO (essential mode da
  // solo non basta a chi cerca un sotto-comando avanzato).
  program.helpCommand(false);

  registerSetupCommand(program);
  registerConfigCommand(program);
  registerWorkingHoursCommand(program);
  registerStatusCommand(program);
  registerTeamCommand(program);
  registerCronCommand(program);
  registerExportCommand(program);
  registerImportCommand(program);
  registerHealthCommand(program);
  registerBackupCommand(program);
  registerMigrateCommand(program);
  registerCacheCommand(program);
  registerToolsCommand(program);
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
  registerKeyringCommand(program);
  registerHooksCommand(program);
  registerReportCommand(program);
  registerWebhooksCommand(program);
  registerCloudCommand(program);
  registerSentinellaCommand(program);
  registerContainerCommand(program);
  registerPositionsCommand(program);
  registerTicketCommand(program);
  registerDirectivesCommand(program);
  registerProfileCommand(program);
  registerPid1Command(program);

  // Salviamo il riferimento all'help "lungo" autogenerato da commander
  // PRIMA di sovrascrivere helpInformation. `jht help` lo invoca per
  // mostrare tutti i sotto-comandi registrati sopra.
  const fullHelp = Command.prototype.helpInformation.bind(program);

  program.helpInformation = function () {
    return ESSENTIAL_HELP;
  };

  program
    .command('help')
    .description('Mostra TUTTI i comandi disponibili (versione lunga)')
    .action(() => {
      process.stdout.write(fullHelp());
    });

  return program;
}
