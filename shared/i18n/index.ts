/**
 * i18n — Internazionalizzazione italiano/inglese
 */

export type { Locale, TranslationMap, TranslationDictionary, TranslateOptions, I18nConfig } from './types.js';
export { LOCALES, DEFAULT_LOCALE, DEFAULT_I18N_CONFIG, isValidLocale } from './types.js';

export { translations } from './translations.js';

export {
  t,
  getLocale,
  setLocale,
  getFallbackLocale,
  detectLocale,
  addTranslations,
  resetI18n,
} from './i18n.js';
