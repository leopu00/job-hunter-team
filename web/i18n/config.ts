export type Locale = 'en' | 'it';

export const defaultLocale: Locale = 'en';
export const locales: Locale[] = ['en', 'it'];

export const localeLabels: Record<Locale, { label: string; flag: string }> = {
  en: { label: 'English', flag: 'EN' },
  it: { label: 'Italiano', flag: 'IT' },
};
