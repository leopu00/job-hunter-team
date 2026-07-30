/**
 * JHT Setup Wizard — Non-interactive mode
 *
 * Ogni prompt del wizard ha un flag CLI equivalente.
 * Pattern copiato da OpenClaw (openclaw/src/commands/onboard-non-interactive.ts).
 *
 * Uso:
 *   jht setup --non-interactive --provider claude --api-key sk-ant-... --model claude-sonnet-4-6
 *   jht setup --non-interactive --provider claude --secret-mode env --secret-env ANTHROPIC_API_KEY
 */
import pc from 'picocolors';
import {
  AI_PROVIDERS,
  writeConfigFile,
  validateApiKey,
} from './setup-helpers.js';
import { formatSecretForConfig, resolveSecret, describeSecret } from './secret-ref.js';
import { runHealthCheck } from './setup-checks.js';

/**
 * Crea un prompter finto per passare a runHealthCheck (serve solo progress).
 */
function silentPrompter() {
  return {
    progress: (label) => {
      console.log(pc.dim(`  ${label}`));
      return {
        update: (msg) => console.log(pc.dim(`  ${msg}`)),
        stop: (msg) => console.log(msg ? pc.green(`  ${msg}`) : ''),
      };
    },
    note: async (msg, title) => { if (title) console.log(pc.bold(title)); console.log(msg); },
    confirm: async () => true,
  };
}

/**
 * Esegue il setup in modalita' non-interattiva.
 * @param {object} opts — flag CLI da Commander
 */
export async function runNonInteractiveSetup(opts) {
  console.log(pc.bold(pc.cyan('\n  JHT Setup — Non-interactive mode\n')));

  // --- Validazione flag obbligatori ---
  const providerName = opts.provider || 'claude';
  const selectedProvider = AI_PROVIDERS.find((p) => p.value === providerName);
  if (!selectedProvider) {
    console.error(pc.red(`Provider "${providerName}" non valido. Usa: claude, openai, minimax`));
    process.exitCode = 1;
    return;
  }

  const authMethod = opts.authMethod || 'api_key';
  const secretMode = opts.secretMode || 'plaintext';
  const model = opts.model || selectedProvider.models[0].value;
  const workspace = opts.workspace || `${process.env.HOME || '~'}/jht`;

  // --- Assembla API key (SecretRef) ---
  let apiKeySecret;
  if (authMethod === 'api_key') {
    if (secretMode === 'env') {
      const envName = opts.secretEnv || (providerName === 'claude' ? 'ANTHROPIC_API_KEY' : `${providerName.toUpperCase()}_API_KEY`);
      apiKeySecret = formatSecretForConfig('env', envName);
    } else if (secretMode === 'file') {
      if (!opts.secretFile) {
        console.error(pc.red('--secret-file obbligatorio con --secret-mode file'));
        process.exitCode = 1;
        return;
      }
      apiKeySecret = formatSecretForConfig('file', opts.secretFile);
    } else {
      if (!opts.apiKey) {
        console.error(pc.red('--api-key obbligatorio (oppure usa --secret-mode env/file)'));
        process.exitCode = 1;
        return;
      }
      const err = validateApiKey(selectedProvider, opts.apiKey);
      if (err) { console.error(pc.red(err)); process.exitCode = 1; return; }
      apiKeySecret = formatSecretForConfig('plaintext', opts.apiKey.trim());
    }
  }

  // --- Health check ---
  if (!opts.skipHealth && authMethod === 'api_key') {
    const prompter = silentPrompter();
    const ok = await runHealthCheck(prompter, selectedProvider, apiKeySecret);
    if (!ok) console.log(pc.yellow('  Health check fallito — la config viene salvata comunque.'));
  }

  // --- Assembla e salva config ---
  const providerConfig = { name: providerName, auth_method: authMethod, model };
  if (apiKeySecret) {
    if (apiKeySecret.type === 'plaintext') providerConfig.api_key = apiKeySecret.value;
    else providerConfig.api_key_ref = apiKeySecret;
  }

  const config = {
    version: 1,
    active_provider: providerName,
    providers: { [providerName]: providerConfig },
    channels: {},
    workspace,
  };

  try {
    writeConfigFile(config);
  } catch (err) {
    console.error(pc.red(`Errore salvataggio: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // --- Riepilogo ---
  console.log(pc.green('\n  Config salvata!\n'));
  console.log(`  Provider:   ${selectedProvider.label}`);
  console.log(`  Auth:       ${authMethod === 'api_key' ? describeSecret(apiKeySecret) : 'subscription'}`);
  console.log(`  Modello:    ${model}`);
  console.log(`  Workspace:  ${workspace}`);
  console.log('');
}
