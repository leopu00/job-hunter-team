import { getRequestConfig } from 'next-intl/server';
import { getUserLocale } from '@/lib/locale';
import { defaultLocale } from './config';

export default getRequestConfig(async () => {
  const locale = await getUserLocale();

  return {
    locale: locale ?? defaultLocale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
