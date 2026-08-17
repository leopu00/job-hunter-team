/**
 * JHT Setup Wizard — Costanti, provider, validazione, config IO
 */
import fs from 'node:fs';
import { writePrivateJson } from '../src/lib/secure-config-io.js';
import path from 'node:path';
import os from 'node:os';

// Path fissi JHT (specchio di shared/paths.ts, con override env var).
// cli/wizard e' ESM .js e non puo' importare shared/*.ts direttamente.
export const JHT_CONFIG_DIR = process.env.JHT_HOME || path.join(os.homedir(), '.jht');
export const JHT_CONFIG_PATH = path.join(JHT_CONFIG_DIR, 'jht.config.json');

export const AI_PROVIDERS = [
  {
    value: 'claude',
    label: 'Claude',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-api03-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    value: 'openai',
    label: 'OpenAI',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-proj-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'o3', label: 'o3' },
      { value: 'o4-mini', label: 'o4-mini' },
    ],
  },
  {
    value: 'kimi',
    label: 'Kimi',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.moonshot.ai',
    models: [
      { value: 'kimi-k2-0905-preview', label: 'Kimi K2' },
      { value: 'kimi-k2-turbo-preview', label: 'Kimi K2 turbo' },
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
  // Accettiamo sia il nome-VENDOR (openai/anthropic/kimi — quello che scrive
  // `jht providers use`) sia il nome-CLI storico (codex/claude). Storicamente la
  // lista mescolava i registri ('claude' CLI + 'openai' vendor): un active_provider
  // vendor-canonico come 'anthropic' veniva rifiutato. Allineato a config_ready()
  // in .launcher/agent-watchdog.sh. Vedi postmortem 2026-07-18-provider-vendor-enum-config-ready.
  const validProviders = ['claude', 'anthropic', 'openai', 'codex', 'kimi'];

  if (typeof config.version !== 'number' || config.version < 1) {
    errors.push('version must be a positive number');
  }
  if (!validProviders.includes(config.active_provider)) {
    errors.push(`active_provider must be one of: ${validProviders.join(', ')}`);
  }
  if (!config.providers || typeof config.providers !== 'object') {
    errors.push('providers is required');
  }
  if (config.active_provider && !config.providers?.[config.active_provider]) {
    errors.push('The active provider must have an entry in providers');
  }
  // Valida ogni provider configurato
  for (const key of validProviders) {
    const prov = config.providers?.[key];
    if (!prov) continue;
    if (!validProviders.includes(prov.name)) {
      errors.push(`providers.${key}.name is invalid`);
    }
    if (prov.auth_method === 'api_key' && !prov.api_key) {
      errors.push(`providers.${key}: api_key is required when auth_method = 'api_key'`);
    }
    // Per auth_method = 'subscription' non imponiamo piu' un blocco
    // 'subscription' nel config: l'autenticazione vera e' OAuth device-flow
    // gestita dal CLI provider (claude/codex/kimi), che salva il token in
    // ~/.claude/ (e similari) DENTRO al container, non in jht.config.json.
  }
  // workspace non e' piu' parte del config: i path JHT sono fissi
  // (~/.jht + ~/Documents/Job Hunter Team).

  return { success: errors.length === 0, errors };
}

/**
 * Scrive jht.config.json dopo validazione.
 * Compatibile con shared/config/io.ts writeConfig().
 */
export function writeConfigFile(config) {
  const validation = validateConfigBeforeWrite(config);
  if (!validation.success) {
    throw new Error(`Invalid configuration:\n${validation.errors.join('\n')}`);
  }
  writePrivateJson(JHT_CONFIG_PATH, config);
}

// --- Validazione ---

export function validateApiKey(provider, value) {
  if (!value || value.trim().length === 0) {
    return 'The API key cannot be empty';
  }
  const trimmed = value.trim();
  if (trimmed.length < 10) {
    return 'The API key appears too short';
  }
  if (provider.keyPrefix && !trimmed.startsWith(provider.keyPrefix)) {
    return `The key for ${provider.label} should start with "${provider.keyPrefix}"`;
  }
  return undefined;
}

export function validateEmail(value) {
  if (!value || value.trim().length === 0) {
    return 'Email cannot be empty';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    return 'Invalid email';
  }
  return undefined;
}

export function validateTelegramToken(value) {
  if (!value || value.trim().length === 0) {
    return 'The token cannot be empty';
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(value.trim())) {
    return 'Invalid token format (expected: 123456:ABC...)';
  }
  return undefined;
}

export function validateChatId(value) {
  if (value && value.trim().length > 0 && !/^-?\d+$/.test(value.trim())) {
    return 'The chat ID must be a number';
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
    lines.push(`Model: ${activeProviderConfig.model}`);
  }
  if (activeProviderConfig?.auth_method) {
    lines.push(`Auth: ${activeProviderConfig.auth_method}`);
  }
  const bots = config.channels?.telegram?.bots;
  if (bots?.assistente?.bot_token && bots?.capitano?.bot_token && bots?.mentor?.bot_token) {
    lines.push('Telegram: 3 bots configured (assistente, capitano, mentor)');
  } else if (bots) {
    const present = ['assistente', 'capitano', 'mentor'].filter((r) => bots?.[r]?.bot_token);
    lines.push(`Telegram: incomplete (${present.length}/3 bots)`);
  }
  return lines.join('\n') || 'Empty configuration';
}
