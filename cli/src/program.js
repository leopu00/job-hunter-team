import pkg from '../package.json' with { type: 'json' };
import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerConfigCommand } from './commands/config.js';
import { registerWorkingHoursCommand } from './commands/working-hours.js';
import { registerTeamSettingsCommand } from './commands/team-settings.js';
import { registerBurnCommand } from './commands/burn.js';
import { registerStandbyCommand } from './commands/standby.js';
import { registerAgentControlCommand } from './commands/agent-control.js';
import { registerStateStreamCommand } from './commands/state-stream.js';
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
import { registerExistingTeamCommand } from './commands/existing-team.js';
import { registerApplyCommand } from './commands/apply.js';
import { registerTicketCommand, registerDirectivesCommand, registerFeedbackCommand } from './commands/decisions.js';
import { registerArtifactCommand } from './commands/artifacts.js';
import { registerCoordinatorCommand } from './commands/coordinator.js';
import { registerProfileCommand } from './commands/profile.js';
import { registerPid1Command } from './commands/pid1.js';
import { registerDownloadCommand } from './commands/download.js';
import { registerGameCommand } from './commands/game.js';
import { renderFullHelp } from './lib/help-groups.js';
import { errorBlock } from './lib/ui.js';
import { say } from './lib/texts.js';
import { parserLine } from './lib/parser-messages.js';

// Help "essenziale" mostrato di default da `jht`, `jht --help`, `jht -h`.
// Per la lista completa di tutti i sotto-comandi (export/import/cron/
// webhooks/secrets/...) l'utente usa `jht help`. Riduce l'attrito post-
// install: VPS fresca → 30+ sotto-comandi spaventano e nascondono i 5
// che servono davvero. Vedi docs/internal/ops/vps.md → "P1 — Help post-install
// troppo lunga".
//
// Restano CINQUE: la lista è corta apposta, quindi ogni voce che si aggiunge
// ne toglie un'altra. `dashboard` è stato tolto il 2026-07-30 — è deprecato dal
// 2026-07-23 (la dashboard locale non esiste più, il comando stampa solo dove
// sono finite le cose) e la prima schermata dopo l'install non può raccomandare
// un comando che non fa niente. Al suo posto `team`, senza il quale l'help
// essenziale non diceva in nessun punto come si avvia il team.
// the short list is a text of the catalog (`help.essential`), in the language of the person

export function buildProgram() {
  const program = new Command();

  // I flag dopo il nome di un sottocomando appartengono a quel sottocomando.
  // Senza questo gate Commander intercetta anche `jht download --version X`
  // come versione globale della CLI, stampa il numero ed esce 0 senza
  // scaricare nulla. I globali restano disponibili prima del comando
  // (`jht --version`), che e' il contratto non ambiguo.
  program.enablePositionalOptions();

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
  registerTeamSettingsCommand(program);
  registerBurnCommand(program);
  registerStandbyCommand(program);
  registerAgentControlCommand(program);
  registerStateStreamCommand(program);
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
  registerExistingTeamCommand(program);
  registerApplyCommand(program);
  registerTicketCommand(program);
  registerDirectivesCommand(program);
  registerArtifactCommand(program);
  registerFeedbackCommand(program);
  registerCoordinatorCommand(program);
  registerProfileCommand(program);
  registerPid1Command(program);
  registerDownloadCommand(program);
  registerGameCommand(program);

  // The parser's own errors ("error: unknown command 'x'") come out in the same shape as every other error of the
  // program: what happened, the parser's suggestion if it has one, and where to look next (the help of the command
  // that was being used, found from what was typed). Commander shares one output configuration among the
  // commands, so there is one handler and it looks at the arguments.
  const typedCommandPath = () => {
    const path = [];
    let level = program;
    for (const word of process.argv.slice(2)) {
      if (word.startsWith('-')) continue;
      const next = level.commands.find((c) => c.name() === word || c.aliases().includes(word));
      if (!next) break;
      path.push(next.name());
      level = next;
    }
    return path;
  };
  const shapeError = {
    outputError: (text, write) => {
      const [first, ...rest] = String(text).trim().split('\n');
      const path = typedCommandPath();
      write(`${errorBlock({
        what: parserLine(first.replace(/^error:\s*/i, '')),
        why: parserLine(rest.join(' ').replace(/^\(|\)$/g, '')) || null,
        fix: path.length ? say('error.help_command', { path: path.join(' ') }) : say('error.help_all'),
      })}\n`);
    },
  };
  const applyToAll = (command) => {
    command.configureOutput(shapeError);
    command.commands.forEach(applyToAll);
  };
  applyToAll(program);

  // A group of commands asked without a subcommand (`jht cron`) is a request for its help, not an error:
  // the help goes to stdout and the exit code is 0.
  for (const command of program.commands) {
    if (command.commands.length > 0 && !command._actionHandler) command.action(() => command.help());
  }

  // `jht --help` is the short essential list; `jht help` is the long one, in groups, for the width of the terminal.
  program.helpInformation = function () {
    return say('help.essential');
  };

  program
    .command('help')
    .description(say('help.long_description'))
    .action(() => {
      process.stdout.write(renderFullHelp(program, process.stdout.columns || 80));
    });

  return program;
}
