// Valute di visualizzazione configurate per la dashboard (selettore del
// grafico stipendi). Base sempre presenti + quelle aggiunte dall'utente in
// Impostazioni → Valute, persistite in jht.config.json (dashboard.currencies).
import fs from "node:fs";
import { JHT_CONFIG_PATH } from "@/lib/jht-paths";
import { BASE_CURRENCIES, AVAILABLE_CURRENCIES } from "@/lib/exchange-rates";

const VALID = new Set(AVAILABLE_CURRENCIES.map((c) => c.code));

export function getDisplayCurrencies(): string[] {
  const base = [...BASE_CURRENCIES] as string[];
  try {
    const cfg = JSON.parse(fs.readFileSync(JHT_CONFIG_PATH, "utf-8"));
    const extra = (cfg?.dashboard?.currencies ?? []) as unknown;
    if (!Array.isArray(extra)) return base;
    const added = extra.filter(
      (c): c is string =>
        typeof c === "string" && VALID.has(c) && !base.includes(c),
    );
    return [...base, ...added];
  } catch {
    return base;
  }
}
