"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<
  Locale,
  {
    d7: string;
    d30: string;
    d90: string;
    y1: string;
    from: string;
    to: string;
    days: (n: number) => string;
  }
> = {
  it: {
    d7: "7g",
    d30: "30g",
    d90: "90g",
    y1: "1 anno",
    from: "dal",
    to: "al",
    days: (n) => `${n} giorni`,
  },
  en: {
    d7: "7d",
    d30: "30d",
    d90: "90d",
    y1: "1 year",
    from: "from",
    to: "to",
    days: (n) => `${n} days`,
  },
  es: {
    d7: "7d",
    d30: "30d",
    d90: "90d",
    y1: "1 año",
    from: "del",
    to: "al",
    days: (n) => `${n} días`,
  },
  fr: {
    d7: "7j",
    d30: "30j",
    d90: "90j",
    y1: "1 an",
    from: "du",
    to: "au",
    days: (n) => `${n} jours`,
  },
  de: {
    d7: "7T",
    d30: "30T",
    d90: "90T",
    y1: "1 Jahr",
    from: "von",
    to: "bis",
    days: (n) => `${n} Tage`,
  },
  hu: {
    d7: "7n",
    d30: "30n",
    d90: "90n",
    y1: "1 év",
    from: "tól",
    to: "ig",
    days: (n) => `${n} nap`,
  },
  pt: {
    d7: "7d",
    d30: "30d",
    d90: "90d",
    y1: "1 ano",
    from: "de",
    to: "até",
    days: (n) => `${n} dias`,
  },
};

const PRESET_DAYS: { key: "d7" | "d30" | "d90" | "y1"; days: number }[] = [
  { key: "d7", days: 7 },
  { key: "d30", days: 30 },
  { key: "d90", days: 90 },
  { key: "y1", days: 365 },
];

// Oggi in UTC come 'YYYY-MM-DD' (coerente con l'asse server).
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftKey(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function RangePicker({
  from,
  to,
  days,
}: {
  from: string;
  to: string;
  days: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = T[useLocale()];

  const apply = useCallback(
    (nextFrom: string, nextTo: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("from", nextFrom);
      params.set("to", nextTo);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const applyPreset = (d: number) => {
    const t = todayKey();
    apply(shiftKey(t, -(d - 1)), t);
  };

  const today = todayKey();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-8">
      {/* Preset rapidi */}
      <div className="flex items-center gap-1.5">
        {PRESET_DAYS.map((p) => {
          const active = days === p.days && to === today;
          return (
            <button
              key={p.key}
              onClick={() => applyPreset(p.days)}
              className="px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide transition-colors"
              style={{
                background: active ? "var(--color-blue)" : "transparent",
                color: active ? "#0a0a0a" : "var(--color-muted)",
                border: `1px solid ${active ? "var(--color-blue)" : "var(--color-border)"}`,
                fontFamily: "inherit",
              }}
            >
              {t[p.key]}
            </button>
          );
        })}
      </div>

      {/* Range custom */}
      <div className="flex max-w-full flex-wrap items-center gap-2">
        <span className="text-[10px] text-[var(--color-dim)] uppercase tracking-widest">
          {t.from}
        </span>
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && apply(e.target.value, to)}
          className="min-h-11 min-w-0 bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11px] text-[var(--color-white)] outline-none focus:border-[var(--color-blue)] transition-colors"
          style={{ colorScheme: "dark", fontFamily: "inherit" }}
        />
        <span className="text-[10px] text-[var(--color-dim)] uppercase tracking-widest">
          {t.to}
        </span>
        <input
          type="date"
          value={to}
          min={from}
          max={today}
          onChange={(e) => e.target.value && apply(from, e.target.value)}
          className="min-h-11 min-w-0 bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11px] text-[var(--color-white)] outline-none focus:border-[var(--color-blue)] transition-colors"
          style={{ colorScheme: "dark", fontFamily: "inherit" }}
        />
        <span className="text-[10px] text-[var(--color-dim)] tabular-nums">
          · {t.days(days)}
        </span>
      </div>
    </div>
  );
}
