#!/usr/bin/env node

/**
 * JHT Setup Wizard — Entry point
 */

import pc from 'picocolors';
import { createClackPrompter } from './clack-prompter.js';
import { WizardCancelledError } from './prompts.js';
import { runSetupWizard } from './setup.js';

function printBanner() {
  console.log('');
  console.log(pc.bold(pc.cyan('   ╔═══════════════════════════════════════╗')));
  console.log(pc.bold(pc.cyan('   ║                                       ║')));
  console.log(pc.bold(pc.cyan('   ║') + '    JOB HUNTER TEAM  —  Setup Wizard   ' + pc.cyan('║')));
  console.log(pc.bold(pc.cyan('   ║                                       ║')));
  console.log(pc.bold(pc.cyan('   ╚═══════════════════════════════════════╝')));
  console.log('');
}

async function main() {
  printBanner();

  const prompter = createClackPrompter();

  try {
    await runSetupWizard(prompter);
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      process.exit(0);
    }
    console.error(pc.red('Errore imprevisto:'), err.message);
    process.exit(1);
  }
}

main();
