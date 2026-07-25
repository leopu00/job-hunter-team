"use client";

/**
 * Hook + helper client per leggere la locale corrente da un'unica fonte:
 * il cookie `NEXT_LOCALE`. È la stessa fonte che usano DashboardI18n e il
 * LanguageSwitcher — scritta sia dallo switcher della dashboard sia dalla
 * landing (via POST /api/i18n).
 *
 * Prima di questo hook diversi componenti leggevano `localStorage['jht-lang']`,
 * che però viene scritto SOLO dalla landing: nella dashboard restavano quindi
 * bloccati sul default (it) ignorando il cambio lingua. Vedi
 * docs/internal o la cronologia git per il contesto.
 */
import { useState, useEffect } from "react";
import { locales, defaultLocale, type Locale } from "@/i18n/config";

export function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return defaultLocale;
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const raw = match?.[1];
  if (raw && (locales as string[]).includes(raw)) return raw as Locale;
  // Fallback retro-compatibile: la landing (e vecchi flussi) salvavano la
  // scelta solo in localStorage. Se il cookie non c'è ancora, leggiamo lì.
  try {
    const stored = localStorage.getItem("jht-lang");
    if (stored && (locales as string[]).includes(stored))
      return stored as Locale;
  } catch {
    /* localStorage non disponibile */
  }
  return defaultLocale;
}

/**
 * Locale reattiva al mount. Inizializza con `defaultLocale` per evitare
 * hydration mismatch (il server non conosce il cookie del client in fase di
 * render statico), poi legge la fonte reale dopo il mount.
 */
export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  useEffect(() => {
    setLocale(readLocaleCookie());
  }, []);
  return locale;
}
