/**
 * JHT Provider Loader — Carica credenziali dal config centralizzato
 *
 * Legge ~/.jht/jht.config.json e restituisce la configurazione
 * del provider attivo, pronta per l'uso dagli agenti.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const JHT_CONFIG_DIR = path.join(os.homedir(), '.jht');
const JHT_CONFIG_PATH = path.join(JHT_CONFIG_DIR, 'jht.config.json');

/**
 * Legge la config JHT dal disco.
 * @returns {{ success: boolean, config?: object, error?: string }}
 */
export function loadConfig() {
  if (!fs.existsSync(JHT_CONFIG_PATH)) {
    return { success: false, error: `Config non trovata: ${JHT_CONFIG_PATH}. Esegui: jht setup` };
  }
  try {
    const raw = fs.readFileSync(JHT_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    return { success: true, config };
  } catch (err) {
    return { success: false, error: `Errore lettura config: ${err.message}` };
  }
}

/**
 * Restituisce la configurazione del provider attivo.
 * @returns {{ success: boolean, provider?: object, name?: string, error?: string }}
 */
export function getActiveProvider() {
  const result = loadConfig();
  if (!result.success) return result;

  const { config } = result;
  const name = config.active_provider;
  if (!name) {
    return { success: false, error: 'active_provider non impostato nel config' };
  }

  const provider = config.providers?.[name];
  if (!provider) {
    return { success: false, error: `Provider "${name}" non configurato in providers` };
  }

  return { success: true, provider, name };
}

/**
 * Restituisce le credenziali di autenticazione del provider attivo.
 * @returns {{ success: boolean, credentials?: object, error?: string }}
 */
export function getActiveCredentials() {
  const result = getActiveProvider();
  if (!result.success) return result;

  const { provider, name } = result;
  const { auth_method } = provider;

  if (auth_method === 'api_key') {
    if (!provider.api_key) {
      return { success: false, error: `API key mancante per ${name}. Esegui: jht setup` };
    }
    return {
      success: true,
      credentials: {
        provider: name,
        auth_method: 'api_key',
        api_key: provider.api_key,
        model: provider.model,
      },
    };
  }

  if (auth_method === 'subscription') {
    if (!provider.subscription?.email) {
      return { success: false, error: `Email subscription mancante per ${name}` };
    }
    return {
      success: true,
      credentials: {
        provider: name,
        auth_method: 'subscription',
        email: provider.subscription.email,
        session_token: provider.subscription.session_token,
        model: provider.model,
      },
    };
  }

  return { success: false, error: `auth_method non supportato: ${auth_method}` };
}

/**
 * Restituisce la configurazione del canale Telegram (se presente).
 * @returns {{ configured: boolean, bot_token?: string, chat_id?: string }}
 */
export function getTelegramChannel() {
  const result = loadConfig();
  if (!result.success) return { configured: false };

  const tg = result.config.channels?.telegram;
  if (!tg?.bot_token) return { configured: false };

  return { configured: true, bot_token: tg.bot_token, chat_id: tg.chat_id };
}

/**
 * Restituisce il path della workspace configurata.
 * @returns {string|null}
 */
export function getWorkspacePath() {
  const result = loadConfig();
  if (!result.success) return null;
  return result.config.workspace || null;
}
