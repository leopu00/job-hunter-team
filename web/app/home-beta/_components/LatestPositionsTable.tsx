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
const TABLE_PIN_COUNT = 10;
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
const SCOUT_CompanyS: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7],
  [8, 9],
  [10, 11, 12, 13],
];
const ANALYST_CompanyS: number[][] = [
  [0, 1],
  [3, 4],
  [6, 7],
  [9, 10, 12, 13],
];
const SCORER_CompanyS: number[][] = [[0, 4], [6, 7], [9, 10, 13]];
const WRITER_CompanyS: number[][] = [[4, 7], [9, 13]];
const ROUND2_WRITER_CompanyS: number[][] = [
  [18, 10, 11, 20, 12, 21],
  [13, 22, 14, 0, 1, 4],
  [2, 3, 19, 5, 6, 23],
  [15, 17, 16, 7, 8, 9],
];

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
  status = applyStep(status, "checked", pinIdx, SCOUT_CompanyS, STEP_STARTS.scoutDB, T);
  status = applyStep(status, "scored", pinIdx, ANALYST_CompanyS, STEP_STARTS.analystDB, T);
  status = applyStep(status, "writing", pinIdx, SCORER_CompanyS, STEP_STARTS.scorerDB, T);
  status = applyStep(status, "ready", pinIdx, WRITER_CompanyS, STEP_STARTS.writerDB, T);
  status = applyStep(status, "ready", pinIdx, ROUND2_WRITER_CompanyS, STEP_STARTS.round2WriterDB, T);
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

// Voto sintetico generato deterministicamente dall'id (così resta
// stabile tra render). Mostrato solo quando status >= "scored".
function votoFor(pinIdx: number): number {
  // Hash semplice → range 6.0–8.8
  const seed = (pinIdx * 2654435761) >>> 0;
  return Math.round((6 + (seed % 28) / 10) * 10) / 10;
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
            {/* col widths, ordine: Status | Title | Company | Location | Voto | Salary | Updated */}
            <colgroup>
              <col style={{ width: "9%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "9%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
                <th className="px-3 py-2 font-normal whitespace-nowrap">Status</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Title</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Company</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Location</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">Voto</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">Salary</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">Updated</th>
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
                recent.map((p, i) => {
                  const flash = flashes[i];
                  const status = statuses[i] ?? "new";
                  const statusColor = STATUS_COLORS[status] ?? "#94a3b8";
                  // Voto sintetico stabile solo quando lo status indica
                  // che lo Scorer (o successivi) ha lavorato il pin.
                  const showVoto =
                    status === "scored" ||
                    status === "writing" ||
                    status === "ready";
                  const voto = showVoto ? votoFor(i) : null;
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
                      }}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide"
                          style={{
                            background: `${statusColor}22`,
                            color: statusColor,
                            border: `1px solid ${statusColor}55`,
                          }}
                        >
                          {status}
                        </span>
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
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-bright)] font-mono tabular-nums">
                        {typeof voto === "number" ? voto.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-muted)] font-mono tabular-nums">
                        {salary}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-dim)] font-mono tabular-nums">
                        {formatRelative(updatedAt)}
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
