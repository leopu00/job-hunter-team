/**
 * JHT CLI — Comando setup: avvia il wizard interattivo clack
 */
import pc from 'picocolors';
import { createClackPrompter } from '../../wizard/clack-prompter.js';
import { WizardCancelledError } from '../../wizard/prompts.js';
import { runSetupWizard } from '../../wizard/setup.js';

function printBanner() {
  console.log('');
  console.log(pc.bold(pc.cyan('   ╔═══════════════════════════════════════╗')));
  console.log(pc.bold(pc.cyan('   ║                                       ║')));
  console.log(pc.bold(pc.cyan('   ║') + '    JOB HUNTER TEAM  —  Setup Wizard   ' + pc.cyan('║')));
  console.log(pc.bold(pc.cyan('   ║                                       ║')));
  console.log(pc.bold(pc.cyan('   ╚═══════════════════════════════════════╝')));
  console.log('');
}

async function handleSetup() {
  printBanner();
  const prompter = createClackPrompter();
  try {
    await runSetupWizard(prompter);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      return;
    }
    console.error(pc.red('Errore imprevisto:'), err.message);
    process.exitCode = 1;
  }
}

export function registerSetupCommand(program) {
  program
    .command('setup')
    .description('Wizard di configurazione iniziale')
    .action(handleSetup);
}
