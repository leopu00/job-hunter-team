"use client";

import { useEffect, useState } from "react";
import {
  LUXURY_POSITIONS,
  type LuxuryPosition,
} from "../_data/luxuryPositions";

const TABLE_LIMIT = 15;

// Una riga viene scoperta ogni REVEAL_STEP_PX di scroll sul pin section
// "table-reveal". La prima compare quasi subito (offset 50), così non
// si vede mai una tabella completamente vuota. Step 140 → 15 righe in
// 2010 px di scroll, ci sta dentro un pin di ~3300 px.
const REVEAL_STEP_PX = 140;
const REVEAL_FIRST_OFFSET_PX = 50;
const STICKY_TOP_OFFSET_PX = 80;

// Match score deterministico per id — stabile tra render e
// indipendente dall'ordine in cui le posizioni vengono passate.
// Range 62–96 (%).
function matchScoreFor(id: string): number {
  let seed = 0;
  for (let i = 0; i < id.length; i++) {
    seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  }
  return 62 + (seed % 35);
}

// Salary mappata sul range globale del dataset (~25k–95k). Usata per
// la barra verticale accanto alla cifra: barra alta = top del range.
const SALARY_MIN_GLOBAL = 25000;
const SALARY_MAX_GLOBAL = 95000;
function salaryPercentFor(p: LuxuryPosition): number {
  const lo = p.salary_declared_min ?? 0;
  const hi = p.salary_declared_max ?? 0;
  if (!lo && !hi) return 0;
  const avg = (lo + hi) / 2;
  const pct =
    ((avg - SALARY_MIN_GLOBAL) / (SALARY_MAX_GLOBAL - SALARY_MIN_GLOBAL)) *
    100;
  return Math.max(0, Math.min(100, pct));
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export default function LatestPositionsTable() {
  // Top 10 posizioni ordinate per match score desc: il "miglior
  // risultato" del team in cima. Sono tutte in stato finale "ready"
  // (CV scritto, score+salary visibili).
  const top = [...LUXURY_POSITIONS]
    .map((p) => ({ p, score: matchScoreFor(p.id) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TABLE_LIMIT);

  // Numero di righe visibili in funzione dello scroll sul pin
  // "table-reveal". Crescente, si ferma a TABLE_LIMIT. Mobile (niente
  // pin) → tutte visibili da subito.
  const [visibleCount, setVisibleCount] = useState(TABLE_LIMIT);

  useEffect(() => {
    const sec = document.querySelector(
      "[data-pin-section='table-reveal']",
    ) as HTMLElement | null;
    if (!sec) return; // mobile / fallback: tutte visibili

    setVisibleCount(0);
    const onScroll = () => {
      const rectTop = sec.getBoundingClientRect().top;
      const T = Math.max(0, STICKY_TOP_OFFSET_PX - rectTop);
      const n =
        T < REVEAL_FIRST_OFFSET_PX
          ? 0
          : Math.min(
              TABLE_LIMIT,
              1 + Math.floor((T - REVEAL_FIRST_OFFSET_PX) / REVEAL_STEP_PX),
            );
      setVisibleCount((prev) => (prev === n ? prev : n));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="pt-2 pb-12 w-full">
      <div className="mx-auto w-full max-w-[1280px] px-4">
        <h2 className="text-[12px] md:text-[13px] font-semibold tracking-[0.18em] uppercase text-[var(--color-bright)] mb-3">
          Top {TABLE_LIMIT} matches
        </h2>
        <div
          className="rounded-md border border-[var(--color-border)] overflow-hidden"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <table
            className="text-[11px]"
            style={{
              borderCollapse: "collapse",
              width: "100%",
              tableLayout: "fixed",
            }}
          >
            {/* col widths, ordine: Updated | Match Score | Title | Company | Location | Salary | CV */}
            <colgroup>
              <col style={{ width: "9%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "19%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "8%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
                <th className="px-3 py-2 font-normal whitespace-nowrap">Updated</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">Match Score</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Title</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Company</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Location</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">Salary</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-center">CV</th>
              </tr>
            </thead>
            <tbody>
              {top.length === 0 || visibleCount === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-[var(--color-dim)]"
                  >
                    {top.length === 0
                      ? "Nessuna posizione ancora."
                      : " "}
                  </td>
                </tr>
              ) : (
                top.slice(0, visibleCount).map(({ p, score }) => {
                  const updatedAt = p.last_action_at ?? p.found_at;
                  const salary = (() => {
                    const lo = p.salary_declared_min;
                    const hi = p.salary_declared_max;
                    if (
                      typeof lo === "number" &&
                      typeof hi === "number" &&
                      (lo || hi)
                    ) {
                      const k = (n: number) => `${Math.round(n / 1000)}k`;
                      return `${k(lo)}–${k(hi)}`;
                    }
                    return "—";
                  })();
                  const salaryPct = salaryPercentFor(p);
                  const salaryColor =
                    salaryPct >= 55
                      ? "#34d399"
                      : salaryPct >= 30
                        ? "#facc15"
                        : "#f59e0b";
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--color-border)] hover:bg-[rgba(255,255,255,0.03)]"
                      style={{
                        // Fade-in soft alla comparsa: la riga viene
                        // montata solo quando lo scroll oltrepassa la
                        // sua soglia, key=p.id riusa il nodo se è già
                        // stato montato (no re-animation).
                        animation: "fade-in 0.4s ease both",
                      }}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-dim)] font-mono tabular-nums">
                        {formatRelative(updatedAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-bright)] font-mono tabular-nums">
                        {/* Match Score: cifra + mini donut chart. */}
                        <div className="flex items-center justify-end gap-2">
                          <span>{`${score}%`}</span>
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 36 36"
                            className="flex-shrink-0 -rotate-90"
                            aria-hidden="true"
                          >
                            <circle
                              cx="18"
                              cy="18"
                              r="14"
                              fill="none"
                              stroke="var(--color-border)"
                              strokeWidth="5"
                            />
                            <circle
                              cx="18"
                              cy="18"
                              r="14"
                              fill="none"
                              stroke={
                                score >= 80
                                  ? "#34d399"
                                  : score >= 65
                                    ? "#facc15"
                                    : "#f59e0b"
                              }
                              strokeWidth="5"
                              strokeLinecap="round"
                              strokeDasharray={`${(score / 100) * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
                            />
                          </svg>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-bright)]">
                        <div className="truncate" title={p.title}>
                          {p.title}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        <div className="truncate" title={p.company}>
                          {p.company}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        <div className="truncate" title={p.location ?? ""}>
                          {p.location ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-muted)] font-mono tabular-nums">
                        <div className="flex items-center justify-end gap-2">
                          <span>{salary}</span>
                          <div
                            className="w-[3px] h-[18px] rounded-sm overflow-hidden relative flex-shrink-0"
                            style={{ background: "var(--color-border)" }}
                          >
                            <div
                              className="absolute bottom-0 left-0 right-0"
                              style={{
                                height: `${salaryPct}%`,
                                background: salaryColor,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {/* CV scritto: spunta verde su tutte le righe
                            (sono le top 10, hanno tutte CV pronto). */}
                        <div className="flex items-center justify-center">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#34d399"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-label="CV scritto"
                          >
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
