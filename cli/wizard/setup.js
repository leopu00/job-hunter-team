/**
 * JHT Setup Wizard — Main orchestration
 *
 * Flusso: prerequisiti → provider AI → auth (SecretRef) → modello →
 *         Telegram → workspace → health check → salva config.
 *
 * Pattern copiato da OpenClaw (openclaw/src/wizard/setup.ts).
 */
import {
  AI_PROVIDERS,
  readConfigFileSnapshot,
  validateApiKey,
  summarizeExistingConfig,
} from './setup-helpers.js';
import {
  promptTelegram,
  promptWorkspace,
  promptSubscription,
  assembleAndSaveConfig,
  showSummary,
} from './setup-steps.js';
import { formatSecretForConfig } from './secret-ref.js';
import { checkPrerequisites, runHealthCheck } from './setup-checks.js';

/**
 * Esegue il setup wizard JHT.
 * @param {import('./prompts.js').WizardPrompter} prompter
 */
export async function runSetupWizard(prompter) {
  await prompter.intro('Job Hunter Team — Setup');

  // --- Step 1: Prerequisiti ---
  const prereqOk = await checkPrerequisites(prompter);
  if (!prereqOk) {
    await prompter.outro('Setup annullato — prerequisiti mancanti.');
    return;
  }

  // --- Config snapshot ---
  const snapshot = readConfigFileSnapshot();
  let baseConfig = snapshot.exists && snapshot.config ? snapshot.config : {};

  if (snapshot.exists && !snapshot.config) {
    await prompter.note(
      'Il file config esiste ma non e\' valido JSON.\nVerra\' ricreato da zero.',
      'Config corrotta',
    );
    baseConfig = {};
  }

  // --- Setup mode ---
  const flow = await prompter.select({
    message: 'Modalita\' di setup',
    options: [
      { value: 'quickstart', label: 'QuickStart', hint: 'configurazione rapida — consigliato' },
      { value: 'advanced', label: 'Avanzato', hint: 'configura ogni dettaglio' },
    ],
    initialValue: 'quickstart',
  });

  // --- Config esistente ---
  if (snapshot.exists && snapshot.config) {
    await prompter.note(summarizeExistingConfig(baseConfig), 'Config esistente');
    const action = await prompter.select({
      message: 'Gestione config',
      options: [
        { value: 'keep', label: 'Mantieni valori esistenti' },
        { value: 'modify', label: 'Aggiorna valori' },
        { value: 'reset', label: 'Ricomincia da zero' },
      ],
    });
    if (action === 'keep') {
      await prompter.outro('Configurazione mantenuta. Nessuna modifica.');
      return;
    }
    if (action === 'reset') baseConfig = {};
  }

  // --- Step 2: Provider AI ---
  const providerChoice = await prompter.select({
    message: 'Provider AI',
    options: AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label, hint: p.hint })),
    initialValue: baseConfig.active_provider || 'claude',
  });
  const selectedProvider = AI_PROVIDERS.find((p) => p.value === providerChoice);

  // --- Auth method ---
  const authMethod = await prompter.select({
    message: 'Metodo di autenticazione',
    options: [
      { value: 'api_key', label: 'API Key', hint: 'inserisci la tua chiave API — consigliato' },
      { value: 'subscription', label: 'Subscription', hint: 'login con email e sessione' },
    ],
    initialValue: baseConfig.providers?.[providerChoice]?.auth_method || 'api_key',
  });

  // --- Step 3: Credenziali con SecretRef ---
  let apiKeySecret;
  let subscriptionConfig;

  if (authMethod === 'api_key') {
    // Chiedi come salvare la key (SecretRef pattern)
    const secretMode = flow === 'advanced'
      ? await prompter.select({
          message: 'Come salvare la API key?',
          options: [
            { value: 'env', label: 'Variabile d\'ambiente', hint: 'consigliato — niente plaintext nel config' },
            { value: 'plaintext', label: 'Nel file config', hint: 'piu\' semplice ma meno sicuro' },
            { value: 'file', label: 'File esterno', hint: 'per Docker/secrets manager' },
          ],
          initialValue: 'env',
        })
      : 'plaintext'; // quickstart usa plaintext per semplicita'

    if (secretMode === 'env') {
      const envName = await prompter.text({
        message: 'Nome variabile d\'ambiente',
        initialValue: providerChoice === 'claude' ? 'ANTHROPIC_API_KEY' : `${providerChoice.toUpperCase()}_API_KEY`,
        placeholder: 'ANTHROPIC_API_KEY',
      });
      apiKeySecret = formatSecretForConfig('env', envName.trim());
      await prompter.note(`Assicurati che ${envName.trim()} sia impostata nel tuo shell profile.`, 'Nota');
    } else if (secretMode === 'file') {
      const filePath = await prompter.text({
        message: 'Path del file con la API key',
        placeholder: '/run/secrets/anthropic-key',
      });
      apiKeySecret = formatSecretForConfig('file', filePath.trim());
    } else {
      await prompter.note(
        `Per ottenere una API key per ${selectedProvider.label}:\n${selectedProvider.docsUrl}`,
        'API Key',
      );
      const rawKey = await prompter.text({
        message: `${selectedProvider.label} API key`,
        placeholder: selectedProvider.keyPlaceholder,
        validate: (value) => validateApiKey(selectedProvider, value),
      });
      apiKeySecret = formatSecretForConfig('plaintext', rawKey.trim());
    }
  }

  if (authMethod === 'subscription') {
    subscriptionConfig = await promptSubscription(prompter, selectedProvider, flow);
  }

  // --- Modello AI ---
  const model = await prompter.select({
    message: 'Modello AI default',
    options: selectedProvider.models,
    initialValue: baseConfig.providers?.[providerChoice]?.model || selectedProvider.models[0].value,
  });

  // --- Telegram, workspace ---
  const telegramChannel = await promptTelegram(prompter, baseConfig.channels);
  const workspace = await promptWorkspace(prompter, flow, baseConfig.workspace);

  // --- Step 5: Health check ---
  if (authMethod === 'api_key') {
    const healthy = await runHealthCheck(prompter, selectedProvider, apiKeySecret);
    if (!healthy) {
      const cont = await prompter.confirm({
        message: 'API key non verificata. Continuare e salvare comunque?',
        initialValue: true,
      });
      if (!cont) {
        await prompter.outro('Setup annullato.');
        return;
      }
    }
  }

  // --- Salva e riepilogo ---
  await assembleAndSaveConfig(prompter, {
    providerChoice, authMethod, apiKey: apiKeySecret, subscriptionConfig, model,
    telegramChannel, workspace, baseProviders: baseConfig.providers || {},
  });

  await showSummary(prompter, {
    selectedProvider, authMethod, apiKeySecret, subscriptionConfig,
    model, telegramChannel, workspace,
  });
}
