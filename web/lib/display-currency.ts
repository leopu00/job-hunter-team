import { AVAILABLE_CURRENCIES } from "@/lib/exchange-rates";

// Preferenza "valuta di visualizzazione stipendi" (Impostazioni → Valuta).
// Vive in un COOKIE (come le colonne di /positions) perché le pagine che
// mostrano stipendi sono server component: il server legge il cookie e
// renderizza già convertito — niente flash né conversione client.
export const DISPLAY_CURRENCY_COOKIE = "jht_display_currency";

const VALID = new Set(AVAILABLE_CURRENCIES.map((c) => c.code));

export function sanitizeDisplayCurrency(v: string | undefined | null): string {
  const code = (v ?? "").toUpperCase();
  return VALID.has(code) ? code : "EUR";
}
