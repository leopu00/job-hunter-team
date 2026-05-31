"use client";

import { useEffect, useRef, useState } from "react";
import {
  LUXURY_POSITIONS,
  type LuxuryPosition,
} from "../_data/luxuryPositions";

type RecentPosition = LuxuryPosition;

const STATUS_COLORS: Record<string, string> = {
  new: "#94a3b8",
  checked: "#38bdf8",
  excluded: "#475569",
  scored: "#a78bfa",
  writing: "#f59e0b",
  review: "#fb923c",
  ready: "#34d399",
  applied: "#22c55e",
  response: "#facc15",
};

// La tabella sotto al globo replica l'evoluzione di stato della
// pipeline: ogni riga parte come "new", poi attraversa "checked"
// (Scout) → "scored" (Analyst) → "writing" (Scorer) → "ready"
// (Writer) → ancora "ready" nel round 2 finale. La progressione è
// derivata dal medesimo T del pin-section "team-flow", così tabella
// e globo cambiano in sincrono.

// Math della pipeline (deve restare allineato a BetaTeamFlow):
const DURATION = 360;
const TABLE_PIN_COUNT = 15;
const STICKY_TOP_OFFSET_PX = 80;

// stepStarts dei 5 step "→ DB" (Scout, Analyst, Scorer, Writer in round 1,
// poi Writer in round 2). Valori derivati da SEQUENCE in BetaTeamFlow.
const STEP_STARTS = {
  scoutDB: 360,
  analystDB: 2520,
  scorerDB: 4320,
  writerDB: 5760,
  round2WriterDB: 7200,
} as const;

// pinGroups di ogni step (allineati a DB_STEPS in BetaTeamFlow).
const SCOUT_GROUPS: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7],
  [8, 9],
  [10, 11, 12, 13],
];
const ANALYST_GROUPS: number[][] = [
  [0, 1],
  [3, 4],
  [6, 7],
  [9, 10, 12, 13],
];
const SCORER_GROUPS: number[][] = [[0, 4], [6, 7], [9, 10, 13]];
const WRITER_GROUPS: number[][] = [[4, 7], [9, 13]];
const ROUND2_WRITER_GROUPS: number[][] = [
  [18, 10, 20, 12, 21],
  [13, 22, 14, 0, 1, 4],
  [3, 19, 6, 23],
  [15, 17, 16, 7, 9],
];

// Pin esclusi a fine pipeline: Vienna(2), Istanbul(5), Seoul(8),
// Las Vegas(11). Restano col colore precedente sul globo, in tabella
// status "excluded" dopo la fine del round 2.
const EXCLUDED_PINS_FINAL = new Set([2, 5, 8, 11]);
const PIPELINE_END_T = 8640;

// Mapping step → status applicato al pin quando la pallina arriva.
function applyStep(
  current: string,
  newStatus: string,
  pinIdx: number,
  groups: number[][],
  stepStart: number,
  T: number,
): string {
  for (let k = 0; k < groups.length; k++) {
    const arrivalT = stepStart + (k + 1) * DURATION;
    if (T >= arrivalT && groups[k].includes(pinIdx)) {
      current = newStatus;
    }
  }
  return current;
}

function computeStatusForPin(pinIdx: number, T: number): string {
  let status = "new";
  status = applyStep(status, "checked", pinIdx, SCOUT_GROUPS, STEP_STARTS.scoutDB, T);
  status = applyStep(status, "scored", pinIdx, ANALYST_GROUPS, STEP_STARTS.analystDB, T);
  status = applyStep(status, "writing", pinIdx, SCORER_GROUPS, STEP_STARTS.scorerDB, T);
  status = applyStep(status, "ready", pinIdx, WRITER_GROUPS, STEP_STARTS.writerDB, T);
  status = applyStep(status, "ready", pinIdx, ROUND2_WRITER_GROUPS, STEP_STARTS.round2WriterDB, T);
  // Override finale: a fine pipeline, alcuni pin sono ESCLUSI.
  if (EXCLUDED_PINS_FINAL.has(pinIdx) && T >= PIPELINE_END_T) {
    status = "excluded";
  }
  return status;
}

// Actor visualizzato in funzione dello status (chi ci ha lavorato ora).
const STATUS_ACTOR: Record<string, string> = {
  new: "scout",
  checked: "analista",
  scored: "scorer",
  writing: "scrittore",
  ready: "scrittore",
};

// Match Score sintetico generato deterministicamente dall'id (così
// resta stabile tra render). Range 62–96 (%), mostrato solo dallo
// status "scored" in poi.
function matchScoreFor(pinIdx: number): number {
  const seed = (pinIdx * 2654435761) >>> 0;
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
    ((avg - SALARY_MIN_GLOBAL) /
      (SALARY_MAX_GLOBAL - SALARY_MIN_GLOBAL)) *
    100;
  return Math.max(0, Math.min(100, pct));
}

type FlashState = { color: string; key: number };

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
  // Mostriamo solo le prime 10 offerte. Inizialmente sono tutte "new",
  // poi evolvono in funzione del T del pin-section team-flow (stesso
  // scroll che pilota il globo) → tabella e globo cambiano in sincrono.
  const recent = LUXURY_POSITIONS.slice(0, TABLE_PIN_COUNT);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [statuses, setStatuses] = useState<string[]>(() =>
    Array(TABLE_PIN_COUNT).fill("new"),
  );
  const [flashes, setFlashes] = useState<Record<number, FlashState>>({});
  const flashKeyRef = useRef(0);
  const lastStatusesRef = useRef<string[]>(Array(TABLE_PIN_COUNT).fill("new"));

  useEffect(() => {
    const sec = document.querySelector(
      "[data-pin-section='table-evolution']",
    ) as HTMLElement | null;

    // Scale del tempo: 1 px di scroll sul pin section avanza T della
    // tabella di T_SPEED_FACTOR. Con 2× l'animazione completa (T = 8640)
    // si esaurisce in ~4320 px di scroll della tabella.
    const T_SPEED_FACTOR = 2;

    const recompute = () => {
      const rectTop = sec ? sec.getBoundingClientRect().top : 0;
      const rawT = Math.max(0, STICKY_TOP_OFFSET_PX - rectTop);
      const T = rawT * T_SPEED_FACTOR;

      const newStatuses: string[] = [];
      for (let i = 0; i < TABLE_PIN_COUNT; i++) {
        newStatuses.push(computeStatusForPin(i, T));
      }

      // Detect cambi di status → trigger flash sul colore del nuovo
      // status. Il flash dura 1.4s e si auto-cancella.
      const prev = lastStatusesRef.current;
      let changed = false;
      for (let i = 0; i < TABLE_PIN_COUNT; i++) {
        if (prev[i] !== newStatuses[i]) {
          changed = true;
          const color = STATUS_COLORS[newStatuses[i]] ?? "#94a3b8";
          flashKeyRef.current += 1;
          const myKey = flashKeyRef.current;
          setFlashes((p) => ({ ...p, [i]: { color, key: myKey } }));
          window.setTimeout(() => {
            setFlashes((p) => {
              if (p[i]?.key !== myKey) return p;
              const rest = { ...p };
              delete rest[i];
              return rest;
            });
          }, 1400);
        }
      }
      if (changed) {
        lastStatusesRef.current = newStatuses;
        setStatuses(newStatuses);
      }
    };

    recompute();
    window.addEventListener("scroll", recompute, { passive: true });
    return () => window.removeEventListener("scroll", recompute);
  }, []);

  return (
    <section ref={sectionRef} className="pt-2 pb-12 w-full">
      <div className="mx-auto w-full max-w-[1280px] px-4">
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
              {recent.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-[var(--color-dim)]"
                  >
                    Nessuna posizione ancora.
                  </td>
                </tr>
              ) : (
                recent
                  .map((p, i) => ({ p, i }))
                  // Mostriamo solo le righe già "trovate" dallo Scout
                  // (status ≠ "new") → le posizioni compaiono a
                  // cascata mentre la pipeline avanza.
                  .filter(({ i }) => statuses[i] !== "new")
                  .map(({ p, i }) => {
                  const flash = flashes[i];
                  const status = statuses[i] ?? "new";
                  const statusColor = STATUS_COLORS[status] ?? "#94a3b8";
                  // Match score visibile solo dopo lo step Scorer
                  // (o successivi).
                  const showScore =
                    status === "scored" ||
                    status === "writing" ||
                    status === "ready";
                  const matchScore = showScore ? matchScoreFor(i) : null;
                  const updatedAt = p.last_action_at ?? p.found_at;
                  const salary = (() => {
                    const lo = p.salary_declared_min;
                    const hi = p.salary_declared_max;
                    if (
                      typeof lo === "number" &&
                      typeof hi === "number" &&
                      (lo || hi)
                    ) {
                      // Formato compatto k€ (es. 58k–72k) — più leggibile
                      // a colpo d'occhio del 58,000–72,000.
                      const k = (n: number) => `${Math.round(n / 1000)}k`;
                      return `${k(lo)}–${k(hi)}`;
                    }
                    return "—";
                  })();
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--color-border)] hover:bg-[rgba(255,255,255,0.03)]"
                      style={{
                        background: flash
                          ? `${flash.color}33`
                          : "transparent",
                        transition: "background 1.4s ease-out",
                        // Fade-in alla comparsa (la riga viene montata
                        // solo dopo che lo Scout l'ha trovata).
                        animation: "fade-in 0.45s ease both",
                      }}
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-dim)] font-mono tabular-nums">
                        {formatRelative(updatedAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-bright)] font-mono tabular-nums">
                        {/* Match Score: cifra + mini donut chart. */}
                        <div className="flex items-center justify-end gap-2">
                          <span>
                            {typeof matchScore === "number"
                              ? `${matchScore}%`
                              : "—"}
                          </span>
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
                            {typeof matchScore === "number" && (
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke={
                                  matchScore >= 80
                                    ? "#34d399"
                                    : matchScore >= 65
                                      ? "#facc15"
                                      : "#f59e0b"
                                }
                                strokeWidth="5"
                                strokeLinecap="round"
                                strokeDasharray={`${(matchScore / 100) * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
                                style={{
                                  transition: "stroke-dasharray 0.6s ease",
                                }}
                              />
                            )}
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
                        <div
                          className="truncate"
                          title={p.location ?? ""}
                        >
                          {p.location ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-muted)] font-mono tabular-nums">
                        {/* Salary: visibile solo dopo lo step Scorer
                            (status "scored" o successivi). Stesso
                            criterio del match score, perché in pipeline
                            il "voto" e la "valutazione economica" sono
                            entrambi prodotti dallo Scorer. */}
                        {(() => {
                          const salaryPct = salaryPercentFor(p);
                          const salaryColor =
                            salaryPct >= 55
                              ? "#34d399"
                              : salaryPct >= 30
                                ? "#facc15"
                                : "#f59e0b";
                          return (
                            <div className="flex items-center justify-end gap-2">
                              <span>{showScore ? salary : "—"}</span>
                              <div
                                className="w-[3px] h-[18px] rounded-sm overflow-hidden relative flex-shrink-0"
                                style={{ background: "var(--color-border)" }}
                              >
                                {showScore && (
                                  <div
                                    className="absolute bottom-0 left-0 right-0"
                                    style={{
                                      height: `${salaryPct}%`,
                                      background: salaryColor,
                                      transition: "height 0.6s ease",
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {/* CV: scritto solo se lo Writer ha completato
                            la riga (status "ready"). SVG visibile,
                            centrato nella cella. */}
                        <div className="flex items-center justify-center">
                          {status === "ready" ? (
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
