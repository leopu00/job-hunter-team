"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const PRESETS: { label: string; days: number }[] = [
  { label: "7g", days: 7 },
  { label: "30g", days: 30 },
  { label: "90g", days: 90 },
  { label: "1 anno", days: 365 },
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
        {PRESETS.map((p) => {
          const active = days === p.days && to === today;
          return (
            <button
              key={p.label}
              onClick={() => applyPreset(p.days)}
              className="px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide transition-colors"
              style={{
                background: active ? "var(--color-blue)" : "transparent",
                color: active ? "#0a0a0a" : "var(--color-muted)",
                border: `1px solid ${active ? "var(--color-blue)" : "var(--color-border)"}`,
                fontFamily: "inherit",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Range custom */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--color-dim)] uppercase tracking-widest">
          dal
        </span>
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && apply(e.target.value, to)}
          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11px] text-[var(--color-white)] outline-none focus:border-[var(--color-blue)] transition-colors"
          style={{ colorScheme: "dark", fontFamily: "inherit" }}
        />
        <span className="text-[10px] text-[var(--color-dim)] uppercase tracking-widest">
          al
        </span>
        <input
          type="date"
          value={to}
          min={from}
          max={today}
          onChange={(e) => e.target.value && apply(from, e.target.value)}
          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11px] text-[var(--color-white)] outline-none focus:border-[var(--color-blue)] transition-colors"
          style={{ colorScheme: "dark", fontFamily: "inherit" }}
        />
        <span className="text-[10px] text-[var(--color-dim)] tabular-nums">
          · {days} giorni
        </span>
      </div>
    </div>
  );
}
