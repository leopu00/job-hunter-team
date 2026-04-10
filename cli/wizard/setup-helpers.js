/**
 * JHT Setup Wizard — Costanti, provider, validazione, config IO
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Path fissi JHT (specchio di shared/paths.ts, con override env var).
// cli/wizard e' ESM .js e non puo' importare shared/*.ts direttamente.
export const JHT_CONFIG_DIR = process.env.JHT_HOME || path.join(os.homedir(), '.jht');
export const JHT_CONFIG_PATH = path.join(JHT_CONFIG_DIR, 'jht.config.json');

export const AI_PROVIDERS = [
  {
    value: 'claude',
    label: 'Anthropic (Claude)',
    hint: 'consigliato — Claude Sonnet/Opus',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-api03-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'veloce e capace — consigliato' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', hint: 'massima qualita\'' },
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'economico e veloce' },
    ],
  },
  {
    value: 'openai',
    label: 'OpenAI (GPT)',
    hint: 'GPT-4o, o3, o4-mini',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-proj-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o', hint: 'veloce e capace — consigliato' },
      { value: 'o3', label: 'o3', hint: 'ragionamento avanzato' },
      { value: 'o4-mini', label: 'o4-mini', hint: 'economico' },
    ],
  },
  {
    value: 'minimax',
    label: 'MiniMax',
    hint: 'alternativa economica',
    keyPrefix: '',
    keyPlaceholder: 'eyJ...',
    docsUrl: 'https://www.minimax.io',
    models: [
      { value: 'minimax-01', label: 'MiniMax-01', hint: 'modello principale' },
      { value: 'abab6.5s', label: 'ABAB 6.5s', hint: 'economico' },
    ],
  },
];

// --- Config IO (compatibile con shared/config/io.ts) ---
export function readConfigFileSnapshot() {
  if (!fs.existsSync(JHT_CONFIG_PATH)) {
    return { exists: false, config: null };
  }
  try {
    const raw = fs.readFileSync(JHT_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    return { exists: true, config };
  } catch {
    return { exists: true, config: null };
  }
}

/**
 * Valida la config prima di scriverla.
 * Replica le regole di shared/config/schema.ts (Zod) in JS puro.
 */
export function validateConfigBeforeWrite(config) {
  const errors = [];
  const validProviders = ['claude', 'openai', 'minimax'];

  if (typeof config.version !== 'number' || config.version < 1) {
    errors.push('version deve essere un numero positivo');
  }
  if (!validProviders.includes(config.active_provider)) {
    errors.push(`active_provider deve essere uno di: ${validProviders.join(', ')}`);
  }
  if (!config.providers || typeof config.providers !== 'object') {
    errors.push('providers e\' obbligatorio');
  }
  if (config.active_provider && !config.providers?.[config.active_provider]) {
    errors.push('Il provider attivo deve avere una configurazione in providers');
  }
  // Valida ogni provider configurato
  for (const key of validProviders) {
    const prov = config.providers?.[key];
    if (!prov) continue;
    if (!validProviders.includes(prov.name)) {
      errors.push(`providers.${key}.name non valido`);
    }
    if (prov.auth_method === 'api_key' && !prov.api_key) {
      errors.push(`providers.${key}: api_key obbligatoria quando auth_method = 'api_key'`);
    }
    if (prov.auth_method === 'subscription' && !prov.subscription) {
      errors.push(`providers.${key}: subscription obbligatorio quando auth_method = 'subscription'`);
    }
    if (prov.subscription && !prov.subscription.email) {
      errors.push(`providers.${key}.subscription: email obbligatoria`);
    }
  }
  if (!config.workspace || typeof config.workspace !== 'string') {
    errors.push('workspace e\' obbligatorio');
  }

  return { success: errors.length === 0, errors };
}

/**
 * Scrive jht.config.json dopo validazione.
 * Compatibile con shared/config/io.ts writeConfig().
 */
export function writeConfigFile(config) {
  const validation = validateConfigBeforeWrite(config);
  if (!validation.success) {
    throw new Error(`Config non valida:\n${validation.errors.join('\n')}`);
  }
  fs.mkdirSync(JHT_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(JHT_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// --- Validazione ---

export function validateApiKey(provider, value) {
  if (!value || value.trim().length === 0) {
    return 'La API key non puo\' essere vuota';
  }
  const trimmed = value.trim();
  if (trimmed.length < 10) {
    return 'La API key sembra troppo corta';
  }
  if (provider.keyPrefix && !trimmed.startsWith(provider.keyPrefix)) {
    return `La key per ${provider.label} dovrebbe iniziare con "${provider.keyPrefix}"`;
  }
  return undefined;
}

export function validateEmail(value) {
  if (!value || value.trim().length === 0) {
    return 'L\'email non puo\' essere vuota';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    return 'Email non valida';
  }
  return undefined;
}

export function validateTelegramToken(value) {
  if (!value || value.trim().length === 0) {
    return 'Il token non puo\' essere vuoto';
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(value.trim())) {
    return 'Formato token non valido (atteso: 123456:ABC...)';
  }
  return undefined;
}

export function validateChatId(value) {
  if (value && value.trim().length > 0 && !/^-?\d+$/.test(value.trim())) {
    return 'Il chat ID deve essere un numero';
  }
  return undefined;
}

// --- Summarize existing config ---

export function summarizeExistingConfig(config) {
  const lines = [];
  if (config.active_provider) {
    const prov = AI_PROVIDERS.find((p) => p.value === config.active_provider);
    lines.push(`Provider: ${prov?.label ?? config.active_provider}`);
  }
  const activeProviderConfig = config.providers?.[config.active_provider];
  if (activeProviderConfig?.model) {
    lines.push(`Modello: ${activeProviderConfig.model}`);
  }
  if (activeProviderConfig?.auth_method) {
    lines.push(`Auth: ${activeProviderConfig.auth_method}`);
  }
  if (config.channels?.telegram) {
    lines.push('Telegram: configurato');
  }
  return lines.join('\n') || 'Config vuota';
}
