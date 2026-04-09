import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { Locale, defaultLocale } from './config';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get('NEXT_LOCALE')?.value;
  const locale = (localeCookie as Locale) || defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
