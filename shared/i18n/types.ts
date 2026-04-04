/**
 * i18n — Tipi per internazionalizzazione
 */

export const LOCALES = ['it', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'it';

/** Mappa chiave → traduzione. Supporta nesting con dot notation. */
export type TranslationMap = Record<string, string | Record<string, string>>;

/** Dizionario completo: locale → traduzioni */
export type TranslationDictionary = Record<Locale, TranslationMap>;

/** Opzioni per la funzione t() */
export interface TranslateOptions {
  /** Variabili per interpolazione: {nome} → valore */
  vars?: Record<string, string | number>;
  /** Conteggio per pluralizzazione (usa chiave .one / .other) */
  count?: number;
  /** Fallback se chiave non trovata */
  fallback?: string;
}

/** Configurazione i18n */
export interface I18nConfig {
  /** Locale attivo */
  locale: Locale;
  /** Locale fallback se chiave mancante */
  fallbackLocale: Locale;
  /** Dizionari caricati */
  dictionaries: TranslationDictionary;
}

export const DEFAULT_I18N_CONFIG: I18nConfig = {
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'en',
  dictionaries: { it: {}, en: {} },
};

/** Verifica se una stringa e' un locale valido */
export function isValidLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
