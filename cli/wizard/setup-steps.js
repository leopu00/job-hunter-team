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
  if (authMethod === 'subscription' && subscriptionConfig) {
    providerConfig.subscription = subscriptionConfig;
  }
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

  // Riepilogo minimo: il wizard chiede solo il provider, tutto il resto
  // (modello per-agente, autenticazione tramite OAuth CLI) e' implicito.
  const summary = [
    `Provider:   ${selectedProvider.label}`,
    `Auth:       OAuth (lo fai nel prossimo step)`,
    '',
    `Config:     ${JHT_CONFIG_PATH}`,
    `JHT home:   ${JHT_CONFIG_DIR}`,
  ].join('\n');

  await prompter.note(summary, 'Riepilogo');
  // L'outro finale viene emesso dal wizard chiamante (setup.js) DOPO gli step
  // post-config (providers update / OAuth / team start). Qui non chiudiamo il
  // flow perche' c'e' altro da chiedere.
}

/**
 * Prompt subscription.
 *
 * Storia: avevamo due path (browser OAuth jht-internal + manuale email/token).
 * Il browser path puntava a `claude.ai/authorize?client_id=jht-claude` che
 * NON esiste su claude.ai (404 Page not found). Era un OAuth abbozzato mai
 * implementato server-side. Rimosso 2026-05-10.
 *
 * Il login OAuth vero (device flow del CLI provider, es. `claude` di
 * @anthropic-ai/claude-code) viene fatto in un step separato del wizard
 * principale: l'utente apre un nuovo terminale e lancia `jht oauth-login`.
 * Qui chiediamo solo l'email del suo account, salvata nel config per
 * tracciabilita' (non usata per autenticarsi).
 */
export async function promptSubscription(prompter, selectedProvider, flow) {
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
