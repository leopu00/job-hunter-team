// Tassi di cambio + valute per il convertitore stipendi della dashboard.
// Fonte: Frankfurter (api.frankfurter.dev) — open source, no API key, dati
// ufficiali BCE. Base EUR; i tassi sono "unità di valuta per 1 EUR".

export type Rates = Record<string, number>;

// Valute SEMPRE disponibili nel selettore (non rimovibili dalle impostazioni).
export const BASE_CURRENCIES = ["EUR", "USD", "GBP"] as const;

// Valute che l'utente può aggiungere dalle impostazioni. Sono TUTTE quelle
// convertibili da Frankfurter (dati BCE): non possiamo offrirne altre perché
// senza tasso non potremmo convertire. Lista completa, filtrabile via ricerca.
export const AVAILABLE_CURRENCIES: { code: string; name: string }[] = [
  { code: "AUD", name: "Australian Dollar" },
  { code: "BGN", name: "Bulgarian Lev" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "CNY", name: "Chinese Renminbi Yuan" },
  { code: "CZK", name: "Czech Koruna" },
  { code: "DKK", name: "Danish Krone" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "HUF", name: "Hungarian Forint" },
  { code: "IDR", name: "Indonesian Rupiah" },
  { code: "ILS", name: "Israeli New Shekel" },
  { code: "INR", name: "Indian Rupee" },
  { code: "ISK", name: "Icelandic Króna" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "KRW", name: "South Korean Won" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "MYR", name: "Malaysian Ringgit" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "PHP", name: "Philippine Peso" },
  { code: "PLN", name: "Polish Złoty" },
  { code: "RON", name: "Romanian Leu" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "THB", name: "Thai Baht" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "USD", name: "United States Dollar" },
  { code: "ZAR", name: "South African Rand" },
];

// Simbolo per la formattazione. Fallback al codice ISO per quelle senza
// simbolo univoco (es. SEK/NOK/DKK condividono "kr").
const SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  JPY: "¥",
  CNY: "CN¥",
  INR: "₹",
  KRW: "₩",
  TRY: "₺",
  BRL: "R$",
  THB: "฿",
  PHP: "₱",
  ILS: "₪",
  HUF: "Ft ",
  PLN: "zł ",
  CZK: "Kč ",
  RON: "lei ",
  BGN: "лв ",
  CAD: "C$",
  AUD: "A$",
  NZD: "NZ$",
  HKD: "HK$",
  SGD: "S$",
  MXN: "MX$",
  IDR: "Rp ",
  MYR: "RM ",
  // Senza simbolo univoco (CHF, SEK, NOK, DKK, ISK, ZAR): si usa il codice ISO.
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? `${code} `;
}

// Formattazione compatta adattiva di un importo: sceglie M / k / unità in base
// alla grandezza, così funziona sia per EUR (60k) sia per valute "grandi" come
// HUF/JPY (1.9M invece dell'illeggibile "1947.8k").
export function formatMoneyCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) {
    const m = n / 1_000_000;
    return (
      (a >= 10_000_000
        ? Math.round(m).toString()
        : m.toFixed(1).replace(/\.0$/, "")) + "M"
    );
  }
  if (a >= 10_000) return `${Math.round(n / 1000)}k`;
  if (a >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n)}`;
}

// Compat: alcune parti usano la mappa direttamente.
export const CURRENCY_SYMBOL = SYMBOLS;

// Fallback statico (ordine di grandezza giugno 2026) se il fetch fallisce.
const FALLBACK: Rates = {
  EUR: 1,
  USD: 1.16,
  GBP: 0.86,
  CHF: 0.92,
  HUF: 395,
  PLN: 4.3,
  SEK: 11.2,
  NOK: 11.5,
  DKK: 7.46,
  CZK: 25,
  RON: 4.97,
  BGN: 1.96,
  JPY: 170,
  CAD: 1.6,
  AUD: 1.78,
  CNY: 8.3,
  INR: 97,
  KRW: 1550,
  TRY: 38,
  BRL: 6.3,
  THB: 38,
  PHP: 66,
  ILS: 4.3,
  HKD: 9.1,
  SGD: 1.5,
  MXN: 21,
  IDR: 18500,
  MYR: 5,
  NZD: 1.9,
  ISK: 145,
  ZAR: 21,
};

export async function getExchangeRates(): Promise<Rates> {
  try {
    // Senza `symbols` Frankfurter ritorna tutte le valute: così abbiamo i
    // tassi sia per la valuta di visualizzazione scelta sia per la valuta
    // originale di ogni offerta (es. CHF) da convertire.
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=EUR", {
      next: { revalidate: 86400 },
    });
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
