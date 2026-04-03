/**
 * JHT Setup Wizard — Step Telegram, workspace, salvataggio, riepilogo
 */
import os from 'node:os';
import path from 'node:path';
import {
  JHT_CONFIG_PATH,
  writeConfigFile,
  validateTelegramToken,
  validateChatId,
  validateWorkspacePath,
} from './setup-helpers.js';

const DEFAULT_WORKSPACE = path.join(os.homedir(), 'jht');

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
 * Step Workspace: chiede path workspace (quickstart usa default).
 */
export async function promptWorkspace(prompter, flow, baseWorkspace) {
  let workspace;
  if (flow === 'quickstart') {
    workspace = baseWorkspace || DEFAULT_WORKSPACE;
  } else {
    workspace = await prompter.text({
      message: 'Path workspace JHT',
      initialValue: baseWorkspace || DEFAULT_WORKSPACE,
      validate: validateWorkspacePath,
    });
    workspace = workspace.trim();
  }
  return path.resolve(workspace);
}

/**
 * Assembla e salva la config finale conforme a shared/config/ schema.
 */
export async function assembleAndSaveConfig(prompter, params) {
  const { providerChoice, authMethod, apiKey, subscriptionConfig, model,
          telegramChannel, workspace, baseProviders } = params;

  const progress = prompter.progress('Salvataggio configurazione...');

  const providerConfig = { name: providerChoice, auth_method: authMethod };
  if (authMethod === 'api_key') providerConfig.api_key = apiKey;
  if (authMethod === 'subscription') providerConfig.subscription = subscriptionConfig;
  providerConfig.model = model;

  const config = {
    version: 1,
    active_provider: providerChoice,
    providers: { ...baseProviders, [providerChoice]: providerConfig },
    channels: {},
    workspace,
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
  const { selectedProvider, authMethod, apiKey, subscriptionConfig,
          model, telegramChannel, workspace } = params;

  const authDisplay = authMethod === 'api_key'
    ? `API Key (${apiKey.slice(0, 8)}${'*'.repeat(8)})`
    : `Subscription (${subscriptionConfig.email})`;

  const summary = [
    `Provider:   ${selectedProvider.label}`,
    `Auth:       ${authDisplay}`,
    `Modello:    ${model}`,
    `Telegram:   ${telegramChannel ? 'configurato' : 'non configurato'}`,
    `Workspace:  ${workspace}`,
    '',
    `Config: ${JHT_CONFIG_PATH}`,
  ].join('\n');

  await prompter.note(summary, 'Riepilogo');
  await prompter.outro('Setup completato! Esegui jht start per avviare il team.');
}
