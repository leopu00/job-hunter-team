// Tassi di cambio per il convertitore stipendi della dashboard.
// Fonte: Frankfurter (api.frankfurter.dev) — open source, no API key, dati
// ufficiali BCE. Base EUR; i tassi sono "unità di valuta per 1 EUR".
// Cache giornaliera (i tassi BCE si aggiornano una volta al giorno) con
// fallback statico se l'API è irraggiungibile (la dashboard non deve mai
// rompersi per un cambio non disponibile).

export type Rates = Record<string, number>;

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "CHF ",
};

// Fallback statico (ordine di grandezza giugno 2026) — usato solo se il
// fetch fallisce. Non deve essere preciso, solo non assurdo.
const FALLBACK: Rates = { EUR: 1, USD: 1.16, GBP: 0.86, CHF: 0.92 };

export async function getExchangeRates(): Promise<Rates> {
  try {
    const res = await fetch(
      "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,GBP,CHF",
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return FALLBACK;
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (!data.rates) return FALLBACK;
    return { EUR: 1, ...data.rates };
  } catch {
    return FALLBACK;
  }
}

// Converte un importo da una valuta all'altra usando i tassi base-EUR.
// rate[X] = unità di X per 1 EUR → importo_to = importo_from / rate[from] * rate[to].
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  rates: Rates,
): number {
  const rf = rates[from] ?? 1;
  const rt = rates[to] ?? 1;
  return (amount / rf) * rt;
}
