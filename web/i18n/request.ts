import { getRequestConfig } from 'next-intl/server';
import { Locale, defaultLocale } from './config';

export default getRequestConfig(async ({ requestLocale }) => {
  // This is a simplified version - in production you might want to
  // detect locale from headers, cookies, or user preferences
  const locale = (requestLocale as Locale) || defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
