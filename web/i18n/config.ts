export type Locale = 'en' | 'it' | 'hu';

export const defaultLocale: Locale = 'it';
export const locales: Locale[] = ['en', 'it', 'hu'];

export const localeLabels: Record<Locale, { label: string; flag: string }> = {
  en: { label: 'English', flag: 'EN' },
  it: { label: 'Italiano', flag: 'IT' },
  hu: { label: 'Magyar', flag: 'HU' },
};
