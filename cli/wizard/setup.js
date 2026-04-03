/**
 * JHT Setup Wizard — Main orchestration
 *
 * Flusso: provider AI, auth, modello, Telegram, workspace.
 * Output conforme a shared/config/ schema.
 */
import {
  AI_PROVIDERS,
  readConfigFileSnapshot,
  validateApiKey,
  validateEmail,
  summarizeExistingConfig,
} from './setup-helpers.js';
import {
  promptTelegram,
  promptWorkspace,
  assembleAndSaveConfig,
  showSummary,
} from './setup-steps.js';

/**
 * Esegue il setup wizard JHT.
 * @param {import('./prompts.js').WizardPrompter} prompter
 */
export async function runSetupWizard(prompter) {
  await prompter.intro('Job Hunter Team — Setup');

  const snapshot = readConfigFileSnapshot();
  let baseConfig = snapshot.exists && snapshot.config ? snapshot.config : {};

  if (snapshot.exists && !snapshot.config) {
    await prompter.note(
      'Il file config esiste ma non e\' valido JSON.\nVerra\' ricreato da zero.',
      'Config corrotta',
    );
    baseConfig = {};
  }

  // --- Setup mode: quickstart vs advanced ---
  const flow = await prompter.select({
    message: 'Modalita\' di setup',
    options: [
      { value: 'quickstart', label: 'QuickStart', hint: 'configurazione rapida — consigliato' },
      { value: 'advanced', label: 'Avanzato', hint: 'configura ogni dettaglio' },
    ],
    initialValue: 'quickstart',
  });

  // --- Gestione config esistente ---
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

  // --- Provider AI ---
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

  // --- Credenziali ---
  let apiKey = undefined;
  let subscriptionConfig = undefined;

  if (authMethod === 'api_key') {
    await prompter.note(
      `Per ottenere una API key per ${selectedProvider.label}:\n${selectedProvider.docsUrl}`,
      'API Key',
    );
    apiKey = await prompter.text({
      message: `${selectedProvider.label} API key`,
      placeholder: selectedProvider.keyPlaceholder,
      validate: (value) => validateApiKey(selectedProvider, value),
    });
    apiKey = apiKey.trim();
  }

  if (authMethod === 'subscription') {
    await prompter.note(
      'Inserisci l\'email del tuo account.\nIl session token e\' opzionale.',
      'Subscription',
    );
    const email = await prompter.text({
      message: 'Email account',
      placeholder: 'utente@esempio.com',
      validate: validateEmail,
    });
    const wantsToken = flow === 'advanced'
      ? await prompter.confirm({ message: 'Hai un session token?', initialValue: false })
      : false;
    let sessionToken = undefined;
    if (wantsToken) {
      sessionToken = await prompter.text({ message: 'Session token', placeholder: 'incolla il token...' });
      sessionToken = sessionToken?.trim() || undefined;
    }
    subscriptionConfig = { email: email.trim() };
    if (sessionToken) subscriptionConfig.session_token = sessionToken;
  }

  // --- Modello AI ---
  const model = await prompter.select({
    message: 'Modello AI default',
    options: selectedProvider.models,
    initialValue: baseConfig.providers?.[providerChoice]?.model || selectedProvider.models[0].value,
  });

  // --- Telegram, workspace, salvataggio, riepilogo ---
  const telegramChannel = await promptTelegram(prompter, baseConfig.channels);
  const workspace = await promptWorkspace(prompter, flow, baseConfig.workspace);

  await assembleAndSaveConfig(prompter, {
    providerChoice, authMethod, apiKey, subscriptionConfig, model,
    telegramChannel, workspace, baseProviders: baseConfig.providers || {},
  });

  await showSummary(prompter, {
    selectedProvider, authMethod, apiKey, subscriptionConfig,
    model, telegramChannel, workspace,
  });
}
