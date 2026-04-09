export type Locale = 'en' | 'it' | 'hu';

export const defaultLocale: Locale = 'en';
export const locales: Locale[] = ['en', 'it', 'hu'];

export const localeLabels: Record<Locale, { label: string; flag: string }> = {
  en: { label: 'English', flag: 'EN' },
  it: { label: 'Italiano', flag: 'IT' },
  hu: { label: 'Magyar', flag: 'HU' },
};
