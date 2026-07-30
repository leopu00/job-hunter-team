#!/usr/bin/env node

/**
 * JHT Setup Wizard — Entry point
 */

import { cancel } from '@clack/prompts';
import pc from 'picocolors';
import { createClackPrompter } from './clack-prompter.js';
import { WizardCancelledError } from './prompts.js';
import { runSetupWizard } from './setup.js';

/**
 * Ripristina il terminale al suo stato normale.
 * @clack/prompts usa raw mode durante l'input — se il processo termina
 * senza ripristinarlo, il terminale resta bloccato (no echo, Ctrl+C rotto).
 */
function restoreTerminal() {
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch { /* ignora se non disponibile */ }
  }
}

// Garantisce il ripristino del terminale su qualsiasi uscita
process.on('exit', restoreTerminal);

// Handler SIGINT esplicito — necessario perché in raw mode il kernel
// non converte Ctrl+C in SIGINT automaticamente su tutti i sistemi.
let sigintHandled = false;
process.on('SIGINT', () => {
  if (sigintHandled) return;
  sigintHandled = true;
  restoreTerminal();
  process.stdout.write('\n');
  cancel(pc.red('Setup interrotto.'));
  process.exit(0);
});

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
