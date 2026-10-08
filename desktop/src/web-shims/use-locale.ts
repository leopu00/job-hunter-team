import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";

/**
 * Stand-in for web/lib/use-locale.ts inside the desktop. The web falls back
 * to Italian when the person chose nothing; the desktop follows the system
 * language instead (lib/app-locale.ts), so the web pages it shows speak the
 * same language as its own screens.
 */
export function readLocaleCookie(): Locale {
  return appLocale();
}

export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(appLocale);
  useEffect(() => {
    setLocale(appLocale());
  }, []);
  return locale;
}
