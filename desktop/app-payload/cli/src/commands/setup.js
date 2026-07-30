/**
 * JHT CLI — Comando setup: wizard interattivo o non-interattivo
 *
 * Pattern copiato da OpenClaw: ogni prompt ha un flag CLI equivalente.
 * Il wizard e' sugar sui flag — stessa logica, due interfacce.
 */
import pc from 'picocolors';
import { createClackPrompter } from '../../wizard/clack-prompter.js';
import { WizardCancelledError } from '../../wizard/prompts.js';
import { runSetupWizard } from '../../wizard/setup.js';
import { runNonInteractiveSetup } from '../../wizard/setup-noninteractive.js';

function printBanner() {
  console.log('');
  console.log(pc.bold(pc.cyan('   ╔═══════════════════════════════════════╗')));
  console.log(pc.bold(pc.cyan('   ║                                       ║')));
  console.log(pc.bold(pc.cyan('   ║') + '    JOB HUNTER TEAM  —  Setup Wizard   ' + pc.cyan('║')));
  console.log(pc.bold(pc.cyan('   ║                                       ║')));
  console.log(pc.bold(pc.cyan('   ╚═══════════════════════════════════════╝')));
  console.log('');
}

async function handleSetup(opts) {
  if (opts.nonInteractive) {
    await runNonInteractiveSetup(opts);
    return;
  }

  printBanner();
  const prompter = createClackPrompter();
  try {
    await runSetupWizard(prompter);
  } catch (err) {
    if (err instanceof WizardCancelledError) return;
    console.error(pc.red('Errore imprevisto:'), err.message);
    process.exitCode = 1;
  }
}

export function registerSetupCommand(program) {
  program
    .command('setup')
    .description('Wizard di configurazione iniziale')
    .option('--non-interactive', 'Esegui senza prompt interattivi')
    .option('--provider <name>', 'Provider AI (claude|openai|minimax)', 'claude')
    .option('--auth-method <method>', 'Metodo auth (api_key|subscription)', 'api_key')
    .option('--api-key <key>', 'API key (plaintext)')
    .option('--secret-mode <mode>', 'Come salvare la key (plaintext|env|file)', 'plaintext')
    .option('--secret-env <name>', 'Nome env var per la API key')
    .option('--secret-file <path>', 'Path file per la API key')
    .option('--model <model>', 'Modello AI default')
    .option('--workspace <path>', 'Path workspace JHT')
    .option('--skip-health', 'Salta il health check della API key')
    .option('--reset', 'Ricomincia la configurazione da zero')
    .action(handleSetup);
}
