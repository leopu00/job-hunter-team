/**
 * i18n — Helper t(), gestione locale, interpolazione
 */
import type { Locale, TranslateOptions, I18nConfig, TranslationMap } from './types.js';
import { DEFAULT_I18N_CONFIG, DEFAULT_LOCALE, isValidLocale } from './types.js';
import { translations as builtinTranslations } from './translations.js';

// --- State ---

let config: I18nConfig = {
  ...DEFAULT_I18N_CONFIG,
  dictionaries: builtinTranslations,
};

// --- Locale management ---

export function getLocale(): Locale {
  return config.locale;
}

export function setLocale(locale: Locale): void {
  config.locale = locale;
}

export function getFallbackLocale(): Locale {
  return config.fallbackLocale;
}

/** Rileva locale da environment o header Accept-Language */
export function detectLocale(acceptLanguage?: string): Locale {
  // 1. Env var
  const envLocale = typeof process !== 'undefined' ? process.env.JHT_LOCALE : undefined;
  if (envLocale && isValidLocale(envLocale)) return envLocale;

  // 2. Accept-Language header
  if (acceptLanguage) {
    const langs = acceptLanguage.split(',').map(l => l.split(';')[0].trim().slice(0, 2).toLowerCase());
    for (const lang of langs) {
      if (isValidLocale(lang)) return lang;
    }
  }

  return DEFAULT_LOCALE;
}

// --- Translation lookup ---

function resolve(map: TranslationMap, key: string): string | undefined {
  // Prova chiave diretta
  const direct = map[key];
  if (typeof direct === 'string') return direct;

  // Prova dot notation: "nav.dashboard" → map["nav"]["dashboard"]
  const parts = key.split('.');
  if (parts.length === 2) {
    const section = map[parts[0]];
    if (typeof section === 'object' && section !== null) {
      const val = section[parts[1]];
      if (typeof val === 'string') return val;
    }
  }

  return undefined;
}

// --- Interpolation ---

function interpolate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const val = vars[key];
    return val !== undefined ? String(val) : match;
  });
}

// --- t() helper ---

/**
 * Traduce una chiave nella locale corrente.
 * Supporta interpolazione {var} e pluralizzazione base (.one/.other).
 */
export function t(key: string, options?: TranslateOptions): string {
  const { vars, count, fallback } = options ?? {};

  // Pluralizzazione: aggiunge .one o .other
  let resolvedKey = key;
  if (count !== undefined) {
    resolvedKey = count === 1 ? `${key}.one` : `${key}.other`;
  }

  // Cerca nella locale attiva
  let text = resolve(config.dictionaries[config.locale] ?? {}, resolvedKey);

  // Fallback locale
  if (text === undefined && config.fallbackLocale !== config.locale) {
    text = resolve(config.dictionaries[config.fallbackLocale] ?? {}, resolvedKey);
  }

  // Fallback chiave originale (senza .one/.other) se plurale non trovato
  if (text === undefined && count !== undefined) {
    text = resolve(config.dictionaries[config.locale] ?? {}, key);
    if (text === undefined) {
      text = resolve(config.dictionaries[config.fallbackLocale] ?? {}, key);
    }
  }

  // Fallback esplicito o chiave
  if (text === undefined) {
    text = fallback ?? key;
  }

  // Interpolazione
  if (vars) text = interpolate(text, vars);
  if (count !== undefined) text = interpolate(text, { n: count, count });

  return text;
}

// --- Custom dictionaries ---

/** Aggiunge/sovrascrive traduzioni per una locale */
export function addTranslations(locale: Locale, extra: TranslationMap): void {
  const existing = config.dictionaries[locale] ?? {};
  config.dictionaries[locale] = { ...existing, ...extra };
}

/** Reset configurazione (utile per test) */
export function resetI18n(): void {
  config = { ...DEFAULT_I18N_CONFIG, dictionaries: { ...builtinTranslations } };
}
