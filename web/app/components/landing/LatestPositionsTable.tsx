"use client";

import { useEffect, useState } from "react";
import { LUXURY_POSITIONS, type LuxuryPosition } from "./_data/luxuryPositions";
import { useLandingI18n } from "./LandingI18n";

const TABLE_LIMIT = 15;

// Una riga viene scoperta ogni REVEAL_STEP_PX di scroll sul pin section
// "table-reveal". La prima compare quasi subito (offset 50), così non
// si vede mai una tabella completamente vuota. Step 140 → 15 righe in
// 2010 px di scroll, ci sta dentro un pin di ~3300 px.
const REVEAL_STEP_PX = 140;
const REVEAL_FIRST_OFFSET_PX = 50;
const STICKY_TOP_OFFSET_PX = 80;

// Seed deterministico per id, usato per il ranking. Non è lo score
// finale: lo score viene assegnato dopo l'ordinamento (vedi sotto)
// così la top 15 ha distribuzione esatta 98 → 70.
function matchSeedFor(id: string): number {
  let seed = 0;
  for (let i = 0; i < id.length; i++) {
    seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  }
  return seed;
}

// Distribuzione esatta: rank 0 (miglior match) = 98, step 2 per ogni
// posizione. Su 24 record: rank 14 (= 15ª riga della tabella) = 70,
// rank 23 (ultima esclusa) = 52. Garantisce floor 70% nella top 15.
const SCORE_TOP = 98;
const SCORE_STEP = 2;

// Scala continua interpolata tra gli stessi 3 colori della barra
// salary: giallo (#facc15, h49 s96 l53) → lime (#a3e635, h75 s78 l56)
// → verde menta (#34d399, h158 s60 l52). Due segmenti lineari così
// il midpoint (t=0.5, score ~85) atterra esattamente sul lime.
function matchScoreColor(score: number): string {
  const LO = 70;
  const HI = 100;
  const t = Math.max(0, Math.min(1, (score - LO) / (HI - LO)));
  let h: number, s: number, l: number;
  if (t < 0.5) {
    const tt = t / 0.5;
    h = 49 + tt * (75 - 49);
    s = 96 + tt * (78 - 96);
    l = 53 + tt * (56 - 53);
  } else {
    const tt = (t - 0.5) / 0.5;
    h = 75 + tt * (158 - 75);
    s = 78 + tt * (60 - 78);
    l = 56 + tt * (52 - 56);
  }
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

// Range di riferimento per la barra verticale del salary: estremi
// derivati dalle medie effettive del dataset, così il salary più
// basso del dataset corrisponde a barra ~vuota e il più alto a barra
// ~piena. Hardcodare 25k–95k schiacciava tutto in 1/3 dell'altezza
// perché i salari reali stanno tutti in un range ristretto.
const SALARY_AVG_RANGE = (() => {
  const avgs: number[] = [];
  for (const p of LUXURY_POSITIONS) {
    const lo = p.salary_declared_min ?? 0;
    const hi = p.salary_declared_max ?? 0;
    if (lo || hi) avgs.push((lo + hi) / 2);
  }
  if (avgs.length === 0) return { lo: 30000, hi: 70000 };
  return { lo: Math.min(...avgs), hi: Math.max(...avgs) };
})();

// Offset minimo 30%: il salary più basso del dataset NON ha barra
// vuota, ha comunque ~1/3 di fill. La distinzione tra "basso del
// dataset" e "alto" è data dai restanti 70% di range.
const SALARY_BAR_MIN_PCT = 30;
const SALARY_BAR_MAX_PCT = 100;
function salaryPercentFor(p: LuxuryPosition): number {
  const lo = p.salary_declared_min ?? 0;
  const hi = p.salary_declared_max ?? 0;
  if (!lo && !hi) return SALARY_BAR_MIN_PCT;
  const avg = (lo + hi) / 2;
  const { lo: rangeLo, hi: rangeHi } = SALARY_AVG_RANGE;
  if (rangeHi <= rangeLo) return SALARY_BAR_MIN_PCT;
  const norm = Math.max(0, Math.min(1, (avg - rangeLo) / (rangeHi - rangeLo)));
  return SALARY_BAR_MIN_PCT + norm * (SALARY_BAR_MAX_PCT - SALARY_BAR_MIN_PCT);
}

function formatRelative(
  iso: string,
  t: (
    key:
      | "rel_just_now"
      | "rel_m_ago"
      | "rel_h_ago"
      | "rel_d_ago"
      | "rel_mo_ago",
  ) => string,
): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return t("rel_just_now");
  const min = Math.floor(diff / 60_000);
  if (min < 60) return t("rel_m_ago").replace("{n}", String(min));
  const h = Math.floor(min / 60);
  if (h < 24) return t("rel_h_ago").replace("{n}", String(h));
  const d = Math.floor(h / 24);
  if (d < 30) return t("rel_d_ago").replace("{n}", String(d));
  const mo = Math.floor(d / 30);
  return t("rel_mo_ago").replace("{n}", String(mo));
}

export default function LatestPositionsTable() {
  const { t } = useLandingI18n();
  // Ranking deterministico: hash → ordinamento → score assegnato per
  // rank. Garantisce che rank 14 (15ª riga) abbia esattamente score
  // 70, niente "outlier" sotto il 70% nella top 15.
  // hasCv: distribuzione sparsa basata su bit alti del seed (~60%
  // delle righe ha CV scritto).
  const top = [...LUXURY_POSITIONS]
    .map((p) => ({ p, seed: matchSeedFor(p.id) }))
    .sort((a, b) => b.seed - a.seed)
    .map(({ p, seed }, idx) => ({
      p,
      score: SCORE_TOP - idx * SCORE_STEP,
      hasCv: (seed >>> 8) % 5 < 3,
    }))
    .slice(0, TABLE_LIMIT);

  // Numero di righe visibili in funzione dello scroll sul pin
  // "table-reveal". Crescente, si ferma a TABLE_LIMIT. Mobile (niente
  // pin) → tutte visibili da subito.
  const [visibleCount, setVisibleCount] = useState(TABLE_LIMIT);
  // mounted: evita hydration mismatch sui tempi relativi
  // (Date.now() differisce tra SSR e client). Prima del mount, le
  // celle "Updated" mostrano un placeholder fisso.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
          {t("table_title").replace("{n}", String(TABLE_LIMIT))}
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
            {/* col widths, ordine: Updated | Match Score | Title | Company | Location | Salary | CV.
                Updated e CV stretti (testi brevi); Title/Company/Location
                prendono lo spazio liberato. Totale 100%. */}
            <colgroup>
              <col style={{ width: "6%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "27%" }} />
              <col style={{ width: "21%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "7%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  {t("table_updated")}
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-center">
                  {t("table_match_score")}
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  {t("table_title_col")}
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  {t("table_company")}
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  {t("table_location")}
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">
                  {t("table_salary")}
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-center">
                  {t("table_cv")}
                </th>
              </tr>
            </thead>
            <tbody>
              {top.length === 0 || visibleCount === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-[var(--color-dim)]"
                  >
                    {top.length === 0 ? t("table_empty") : " "}
                  </td>
                </tr>
              ) : (
                top.slice(0, visibleCount).map(({ p, score, hasCv }) => {
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
                  // Soglie ricalibrate sul nuovo range [30..100]: la
                  // metà inferiore (≤60) gialla, la superiore verde.
                  const salaryColor =
                    salaryPct >= 75
                      ? "#34d399"
                      : salaryPct >= 55
                        ? "#a3e635"
                        : "#facc15";
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
                        {mounted ? formatRelative(updatedAt, t) : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center text-[var(--color-bright)] font-mono tabular-nums">
                        {/* Match Score: cifra + mini donut chart. */}
                        <div className="flex items-center justify-center gap-2">
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
                              stroke={matchScoreColor(score)}
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
                        {/* CV scritto: solo su una parte delle righe
                            (distribuzione sparsa via hash → hasCv);
                            le altre mostrano "—". */}
                        <div className="flex items-center justify-center">
                          {hasCv ? (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#34d399"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-label={t("table_cv_written")}
                            >
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <span
                              className="text-[12px] leading-none"
                              style={{ color: "var(--color-dim)" }}
                              aria-hidden="true"
                            >
                              —
                            </span>
                          )}
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
