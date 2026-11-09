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
import { t } from '../../wizard/i18n.js';

async function handleSetup(opts) {
  if (opts.nonInteractive) {
    await runNonInteractiveSetup(opts);
    return;
  }

  const prompter = createClackPrompter();
  try {
    // a setup that stopped before its end leaves a code that a script can read
    if (!(await runSetupWizard(prompter))) process.exitCode = 1;
  } catch (err) {
    if (err instanceof WizardCancelledError) { process.exitCode = 1; return; }
    console.error(pc.red(t('wizard.cli.unexpected_error')), err.message);
    process.exitCode = 1;
  }
}

export function registerSetupCommand(program) {
  program
    .command('setup')
    .description(t('wizard.cli.description'))
    .option('--non-interactive', t('wizard.cli.non_interactive'))
    .option('--provider <name>', t('wizard.cli.provider'), 'openai')
    .option('--harness <name>', t('wizard.cli.harness'), 'codex')
    .option('--auth-method <method>', t('wizard.cli.auth_method'), 'api_key')
    .option('--api-key <key>', t('wizard.cli.api_key'))
    .option('--api-key-file <path>', t('wizard.cli.api_key_file'))
    .option('--secret-mode <mode>', t('wizard.cli.secret_mode'), 'plaintext')
    .option('--secret-env <name>', t('wizard.cli.secret_env'))
    .option('--secret-file <path>', t('wizard.cli.secret_file'))
    .option('--subscription-email <email>', t('wizard.cli.subscription_email'))
    .option('--subscription-token <token>', t('wizard.cli.subscription_token'))
    .option('--model <model>', t('wizard.cli.model'))
    .option('--skip-health', t('wizard.cli.skip_health'))
    .option('--reset', t('wizard.cli.reset'))
    .action(handleSetup);
}
