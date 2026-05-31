export type Locale = 'en' | 'it' | 'hu' | 'es' | 'de' | 'fr';

export const defaultLocale: Locale = 'it';
export const locales: Locale[] = ['en', 'it', 'hu', 'es', 'de', 'fr'];

export const localeLabels: Record<Locale, { label: string; flag: string }> = {
  en: { label: 'English', flag: 'EN' },
  it: { label: 'Italiano', flag: 'IT' },
  hu: { label: 'Magyar', flag: 'HU' },
  es: { label: 'Español', flag: 'ES' },
  de: { label: 'Deutsch', flag: 'DE' },
  fr: { label: 'Français', flag: 'FR' },
};
