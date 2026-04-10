/**
 * JHT Setup Wizard — Step Telegram, subscription, salvataggio, riepilogo
 * I path JHT sono fissi (~/.jht, ~/Documents/Job Hunter Team), non chiesti.
 */
import {
  JHT_CONFIG_PATH,
  JHT_CONFIG_DIR,
  writeConfigFile,
  validateTelegramToken,
  validateChatId,
  validateEmail,
} from './setup-helpers.js';
import { describeSecret } from './secret-ref.js';
import { hasBrowserSupport } from '../src/auth/browser-open.js';
import { startSubscriptionLogin } from '../src/auth/subscription-login.js';

/**
 * Step Telegram: chiede bot token e chat ID (opzionale).
 */
export async function promptTelegram(prompter, baseChannels) {
  let telegramChannel = baseChannels?.telegram || undefined;

  const setupTelegram = await prompter.confirm({
    message: 'Configurare bot Telegram per le notifiche?',
    initialValue: Boolean(telegramChannel?.bot_token),
  });

  if (!setupTelegram) return undefined;

  await prompter.note(
    'Crea un bot con @BotFather su Telegram e copia il token.\nFormato: 123456789:ABCdefGHI...',
    'Telegram Bot',
  );

  const botToken = await prompter.text({
    message: 'Token del bot Telegram',
    placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
    initialValue: telegramChannel?.bot_token,
    validate: validateTelegramToken,
  });

  const chatId = await prompter.text({
    message: 'Chat ID (opzionale)',
    placeholder: '123456789',
    initialValue: telegramChannel?.chat_id,
    validate: validateChatId,
  });

  telegramChannel = { bot_token: botToken.trim() };
  if (chatId && chatId.trim().length > 0) {
    telegramChannel.chat_id = chatId.trim();
  }
  return telegramChannel;
}

/**
 * Assembla e salva la config finale conforme a shared/config/ schema.
 * apiKey puo' essere un SecretInput (oggetto) o una stringa plaintext legacy.
 */
export async function assembleAndSaveConfig(prompter, params) {
  const { providerChoice, authMethod, apiKey, subscriptionConfig, model,
          telegramChannel, baseProviders } = params;

  const progress = prompter.progress('Salvataggio configurazione...');

  const providerConfig = { name: providerChoice, auth_method: authMethod };
  if (authMethod === 'api_key' && apiKey) {
    // SecretRef: salva l'oggetto intero o estrai il plaintext per retrocompatibilita'
    if (typeof apiKey === 'object' && apiKey.type === 'plaintext') {
      providerConfig.api_key = apiKey.value;
    } else if (typeof apiKey === 'object') {
      providerConfig.api_key_ref = apiKey; // SecretRef nel config
    } else {
      providerConfig.api_key = apiKey;
    }
  }
  if (authMethod === 'subscription') providerConfig.subscription = subscriptionConfig;
  providerConfig.model = model;

  const config = {
    version: 1,
    active_provider: providerChoice,
    providers: { ...baseProviders, [providerChoice]: providerConfig },
    channels: {},
  };

  if (telegramChannel) config.channels.telegram = telegramChannel;

  writeConfigFile(config);
  progress.stop('Configurazione salvata!');
  return config;
}

/**
 * Mostra riepilogo finale.
 */
export async function showSummary(prompter, params) {
  const { selectedProvider, authMethod, apiKeySecret, subscriptionConfig,
          model, telegramChannel } = params;

  const authDisplay = authMethod === 'api_key'
    ? `API Key (${describeSecret(apiKeySecret)})`
    : `Subscription (${subscriptionConfig?.email ?? 'n/a'})`;

  const summary = [
    `Provider:   ${selectedProvider.label}`,
    `Auth:       ${authDisplay}`,
    `Modello:    ${model}`,
    `Telegram:   ${telegramChannel ? 'configurato' : 'non configurato'}`,
    '',
    `Config:     ${JHT_CONFIG_PATH}`,
    `JHT home:   ${JHT_CONFIG_DIR}`,
  ].join('\n');

  await prompter.note(summary, 'Riepilogo');
  await prompter.outro('Setup completato! Esegui jht team start per avviare il team.');
}

/**
 * Prompt subscription: browser OAuth o manuale.
 */
export async function promptSubscription(prompter, selectedProvider, flow) {
  const browserAvailable = hasBrowserSupport();
  const subMethod = await prompter.select({
    message: 'Come vuoi effettuare il login?',
    options: [
      { value: 'browser', label: 'Apri browser per login',
        hint: browserAvailable ? 'consigliato' : 'browser non disponibile (SSH?)' },
      { value: 'manual', label: 'Inserisci email e token manualmente' },
    ],
    initialValue: browserAvailable ? 'browser' : 'manual',
  });

  if (subMethod === 'browser') {
    const providerOAuth = selectedProvider.oauthUrl || `https://${selectedProvider.value}.ai/authorize`;
    const clientId = selectedProvider.oauthClientId || `jht-${selectedProvider.value}`;
    await prompter.note('Si aprira\' il browser per il login.', 'Login via browser');
    const spin = prompter.progress('In attesa del login nel browser...');
    const result = await startSubscriptionLogin({
      authorizeUrl: providerOAuth, clientId, scopes: ['read', 'write'], prompter,
    });
    spin.stop(result ? 'Login completato!' : 'Login fallito.');
    if (result) {
      return { email: `oauth-${selectedProvider.value}`, session_token: result.code, oauth_verifier: result.verifier };
    }
    await prompter.note('Login via browser fallito. Inserisci i dati manualmente.', 'Fallback');
  }
  return promptManualSubscription(prompter, flow);
}

/**
 * Prompt manuale per subscription: email + session token opzionale.
 */
async function promptManualSubscription(prompter, flow) {
  await prompter.note('Inserisci l\'email del tuo account.', 'Subscription manuale');
  const email = await prompter.text({
    message: 'Email account', placeholder: 'utente@esempio.com', validate: validateEmail,
  });
  const wantsToken = flow === 'advanced'
    ? await prompter.confirm({ message: 'Hai un session token?', initialValue: false })
    : false;
  let sessionToken;
  if (wantsToken) {
    sessionToken = await prompter.text({ message: 'Session token', placeholder: 'incolla il token...' });
    sessionToken = sessionToken?.trim() || undefined;
  }
  const config = { email: email.trim() };
  if (sessionToken) config.session_token = sessionToken;
  return config;
}
