"use client";

// Variante INTRADAY del grafico lavoro+budget: per fasi corte (pochi giorni
// fissi) mostra il dettaglio ORA PER ORA invece che giorno per giorno.
//  - barre impilate = azioni/ora per ruolo (asse Y SINISTRO)
//  - linea piena    = budget settimanale cumulato a quell'ora (asse Y DESTRO, %)
// Asse X = ore continue dal primo all'ultimo bucket attivo, con separatori di
// giorno. Pensato per il "free-run" iniziale (es. Codex), dove gli agenti hanno
// girato senza limiti d'orario fino a esaurire il budget: il dettaglio orario
// rende visibile la cadenza 24/7 e il ritmo di consumo che il grafico a giorni
// non può mostrare.

import { useEffect, useRef, useState } from "react";
import type { TeamActivityRole } from "@/lib/team-activity";
import { ROLE_META } from "@/lib/team-activity-meta";
import { useLocale } from "@/lib/use-locale";
import { useTheme } from "@/app/theme-provider";
import type { Locale } from "@/i18n/config";
import ActorIcon from "@/app/components/ActorIcon";

// Colore "linea/asse budget AI": LITERAL hex applicato direttamente agli
// attributi SVG / style inline — MAI via classe CSS o var(), che la build
// (Tailwind v4 / Lightning) prunava facendo sparire la linea. Vedi nota gemella
// in WorkBudgetChart.tsx. ⚠️ NON spostare nel CSS.
const BUDGET_LINE = { dark: "#ffd600", light: "#a16207" } as const;

const T: Record<
  Locale,
  {
    actions: string;
    legendActions: string;
    legendBudget: string;
    cumWeek: string;
    budgetCum: (c: number) => string;
  }
> = {
  it: {
    actions: "azioni",
    legendActions: "Azioni/ora (asse sx)",
    legendBudget: "Budget % (asse dx)",
    cumWeek: "budget cumulato",
    budgetCum: (c) => `budget: ${c}% della settimana`,
  },
  en: {
    actions: "actions",
    legendActions: "Actions/hour (left axis)",
    legendBudget: "Budget % (right axis)",
    cumWeek: "cumulative budget",
    budgetCum: (c) => `budget: ${c}% of the week`,
  },
  es: {
    actions: "acciones",
    legendActions: "Acciones/hora (eje izquierdo)",
    legendBudget: "Presupuesto % (eje derecho)",
    cumWeek: "presupuesto acumulado",
    budgetCum: (c) => `presupuesto: ${c}% de la semana`,
  },
  fr: {
    actions: "actions",
    legendActions: "Actions/heure (axe gauche)",
    legendBudget: "Budget % (axe droit)",
    cumWeek: "budget cumulé",
    budgetCum: (c) => `budget : ${c}% de la semaine`,
  },
  de: {
    actions: "Aktionen",
    legendActions: "Aktionen/Stunde (linke Achse)",
    legendBudget: "Budget % (rechte Achse)",
    cumWeek: "kumuliertes Budget",
    budgetCum: (c) => `Budget: ${c}% der Woche`,
  },
  hu: {
    actions: "művelet",
    legendActions: "Műveletek/óra (bal tengely)",
    legendBudget: "Költségkeret % (jobb tengely)",
    cumWeek: "halmozott keret",
    budgetCum: (c) => `keret: a hét ${c}%-a`,
  },
  pt: {
    actions: "ações",
    legendActions: "Ações/hora (eixo esquerdo)",
    legendBudget: "Orçamento % (eixo direito)",
    cumWeek: "orçamento acumulado",
    budgetCum: (c) => `orçamento: ${c}% da semana`,
  },
};

// "2026-05-20T14" → "20/05"
function dm(hour: string) {
  return `${hour.slice(8, 10)}/${hour.slice(5, 7)}`;
}
// ora del giorno (UTC, com'è salvata la transizione) → "14:00"
function hh(hour: string) {
  return `${hour.slice(11, 13)}:00`;
}

export default function IntradayBudgetChart({
  hourly,
  roles,
}: {
  hourly: { hour: string; counts: Record<string, number>; cum: number }[];
  roles: TeamActivityRole[];
}) {
  const locale = useLocale();
  const t = T[locale];
  const { resolvedTheme } = useTheme();
  const budgetColor = BUDGET_LINE[resolvedTheme] ?? BUDGET_LINE.dark;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const u = () => setW(el.clientWidth);
    u();
    const ro = new ResizeObserver(u);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Asse ore CONTINUO dal primo all'ultimo bucket (le ore vuote restano vuote).
  const byHour = new Map(hourly.map((h) => [h.hour, h]));
  const slots: string[] = [];
  if (hourly.length) {
    const cursor = new Date(`${hourly[0].hour}:00:00Z`);
    const stop = new Date(`${hourly[hourly.length - 1].hour}:00:00Z`);
    while (cursor <= stop) {
      slots.push(cursor.toISOString().slice(0, 13));
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }
  }
  let lastCum = 0;
  const data = slots.map((hour) => {
    const b = byHour.get(hour);
    if (b) lastCum = b.cum;
    const get = (r: TeamActivityRole) => b?.counts[r] ?? 0;
    const total = roles.reduce((s, r) => s + get(r), 0);
    return { hour, get, total, cum: lastCum };
  });

  const n = Math.max(1, data.length);
  const maxActions = Math.max(1, ...data.map((d) => d.total));
  const axisMax = Math.ceil(maxActions / 10) * 10 || 10;

  const H = 320;
  const padL = 30;
  const padR = 34;
  const padT = 14;
  const padB = 34; // più alto: doppia riga di etichette (ora + giorno)
  const W = Math.max(320, w || 800);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const band = plotW / n;
  const barW = Math.min(18, band * 0.66);
  const xc = (i: number) => padL + band * (i + 0.5);
  const yL = (v: number) => padT + plotH - (v / axisMax) * plotH;
  const yR = (pct: number) => padT + plotH - (pct / 100) * plotH;

  const cumLine = data.map((d, i) => `${xc(i)},${yR(d.cum)}`).join(" ");

  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(axisMax * f));
  const rightTicks = [0, 25, 50, 75, 100];
  // separatori di giorno: indici dove cambia la data
  const dayStarts = data
    .map((d, i) => ({ i, day: d.hour.slice(0, 10) }))
    .filter((d, idx) => idx === 0 || d.day !== data[idx - 1].hour.slice(0, 10));
  // etichette ora: ogni ~6 ore
  const hourEvery = Math.max(1, Math.round(n / 8));

  const hd = hover != null ? data[hover] : null;

  return (
    <div ref={wrapRef} className="relative">
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block" }}
      >
        {/* griglia + asse sinistro (azioni) */}
        {leftTicks.map((tk) => (
          <g key={`l${tk}`}>
            <line
              x1={padL}
              x2={padL + plotW}
              y1={yL(tk)}
              y2={yL(tk)}
              stroke="var(--color-border)"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.5}
            />
            <text
              x={padL - 5}
              y={yL(tk) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--color-dim)"
            >
              {tk}
            </text>
          </g>
        ))}
        {/* asse destro (%) */}
        {rightTicks.map((tk) => (
          <text
            key={`r${tk}`}
            fill={budgetColor}
            x={padL + plotW + 5}
            y={yR(tk) + 3}
            textAnchor="start"
            fontSize={9}
            opacity={0.8}
          >
            {tk}%
          </text>
        ))}

        {/* separatori di giorno + etichetta data */}
        {dayStarts.map((d) => (
          <g key={`day${d.i}`}>
            {d.i > 0 && (
              <line
                x1={padL + band * d.i}
                x2={padL + band * d.i}
                y1={padT}
                y2={padT + plotH}
                stroke="var(--color-border)"
                strokeWidth={1}
                opacity={0.5}
              />
            )}
            <text
              x={padL + band * d.i + 4}
              y={H - 8}
              textAnchor="start"
              fontSize={9}
              fontWeight={600}
              fill="var(--color-dim)"
            >
              {dm(data[d.i].hour)}
            </text>
          </g>
        ))}

        {/* barre impilate: azioni per ruolo */}
        {data.map((d, i) => {
          if (d.total <= 0) return null;
          let acc = 0;
          return (
            <g key={d.hour}>
              {roles.map((r) => {
                const c = d.get(r);
                if (c <= 0) return null;
                const h = (c / axisMax) * plotH;
                const y = padT + plotH - (acc / axisMax) * plotH - h;
                acc += c;
                return (
                  <rect
                    key={r}
                    x={xc(i) - barW / 2}
                    y={y}
                    width={barW}
                    height={h}
                    fill={ROLE_META[r].color}
                    opacity={0.85}
                    rx={1}
                  />
                );
              })}
            </g>
          );
        })}

        {/* linea: budget cumulato (asse dx) */}
        <polyline
          stroke={budgetColor}
          points={cumLine}
          fill="none"
          strokeWidth={2}
          opacity={0.95}
          vectorEffect="non-scaling-stroke"
        />

        {/* etichette ora + bande hover */}
        {data.map((d, i) => (
          <g key={`x${d.hour}`}>
            {i % hourEvery === 0 && (
              <text
                x={xc(i)}
                y={H - 20}
                textAnchor="middle"
                fontSize={8}
                fill="var(--color-dim)"
              >
                {hh(d.hour)}
              </text>
            )}
            <rect
              x={padL + band * i}
              y={padT}
              width={band}
              height={plotH}
              fill={hover === i ? "var(--color-muted)" : "transparent"}
              opacity={hover === i ? 0.06 : 0}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "default" }}
            />
          </g>
        ))}
      </svg>

      {/* tooltip */}
      {hd && (
        <div
          className="absolute z-10 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[10px] shadow-xl pointer-events-none"
          style={{
            left: `${(xc(hover!) / W) * 100}%`,
            top: 0,
            transform: "translateX(-50%)",
            minWidth: 150,
          }}
        >
          <div className="font-bold text-[var(--color-white)]">
            {dm(hd.hour)} · {hh(hd.hour)} · {hd.total} {t.actions}
          </div>
          {roles
            .filter((r) => hd.get(r) > 0)
            .map((r) => (
              <div key={r} className="flex items-center gap-1.5 mt-0.5">
                <span
                  className="inline-block w-2 h-2 rounded-sm"
                  style={{ background: ROLE_META[r].color }}
                />
                <span className="text-[var(--color-muted)]">
                  {ROLE_META[r].label}: {hd.get(r)}
                </span>
              </div>
            ))}
          <div className="mt-1 pt-1 border-t border-[var(--color-border)] flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-sm"
              style={{ backgroundColor: budgetColor }}
            />
            <span className="text-[var(--color-muted)]">
              {t.budgetCum(Math.round(hd.cum))}
            </span>
          </div>
        </div>
      )}

      {/* legenda */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] pt-3">
        <span className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
          {t.legendActions}
        </span>
        {roles.map((r) => (
          <span key={r} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: ROLE_META[r].color }}
            />
            <span className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]">
              <ActorIcon role={r} size={10} />
              {ROLE_META[r].label}
            </span>
          </span>
        ))}
        <span className="text-[9px] uppercase tracking-wide text-[var(--color-dim)] ml-2">
          {t.legendBudget}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-4 h-0.5"
            style={{ backgroundColor: budgetColor }}
          />
          <span className="text-[10px] text-[var(--color-muted)]">
            {t.cumWeek}
          </span>
        </span>
      </div>
    </div>
  );
}
