"use client";

import { useMemo } from "react";

const BLUE = "var(--color-blue)";

function pct(n: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

// Grafico a barre orizzontali: da quali fonti (job board, ATS, pagine carriera)
// sono arrivate le posizioni. La voce "Altre" raccoglie la coda lunga ed è
// sempre in fondo, in grigio.
export default function SourcesChart({
  sources,
  total,
}: {
  sources: { name: string; count: number }[];
  total: number;
}) {
  const rows = useMemo(() => {
    const rest = sources
      .filter((s) => s.name !== "Altre")
      .sort((a, b) => b.count - a.count);
    const altre = sources.filter((s) => s.name === "Altre");
    return [...rest, ...altre];
  }, [sources]);

  const max = Math.max(1, ...rows.map((r) => r.count));

  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-[var(--color-dim)]">
        Dato non disponibile in questo snapshot.
      </p>
    );
  }

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6">
      <div className="flex flex-col gap-2">
        {rows.map((s) => {
          const isOther = s.name === "Altre";
          const color = isOther ? "var(--color-dim)" : BLUE;
          return (
            <div key={s.name} className="flex items-center gap-2.5">
              <span
                className="text-[11px] w-40 shrink-0 truncate"
                style={{
                  color: isOther
                    ? "var(--color-dim)"
                    : "var(--color-muted)",
                }}
                title={s.name}
              >
                {s.name}
              </span>
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: "var(--color-border)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(s.count / max) * 100}%`,
                    background: color,
                    opacity: 0.8,
                  }}
                />
              </div>
              <span
                className="text-[11px] font-bold tabular-nums w-8 text-right"
                style={{ color }}
              >
                {s.count}
              </span>
              <span className="text-[10px] tabular-nums w-9 text-right text-[var(--color-dim)]">
                {pct(s.count, total)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
