"use client";

// Grafico UNICO che fonde "volume di lavoro" e "consumo budget" nel tempo:
//  - barre impilate = azioni/giorno per ruolo (asse Y SINISTRO, n. azioni)
//  - linea piena   = budget settimanale cumulato a fine giornata (asse Y DESTRO, %)
//  - linea tratteg.= budget consumato quel giorno (asse Y DESTRO, %)
// Doppio asse Y, colori distinti, tooltip per giorno. Larghezza piena (ResizeObserver).

import { useEffect, useRef, useState } from "react";
import type { CaseStudyUsage } from "@/lib/case-study";
import type {
  TeamActivityRole,
  TeamActivityRoleDay,
} from "@/lib/team-activity";
import { ROLE_META } from "@/lib/team-activity-meta";
import { useLocale } from "@/lib/use-locale";
import { useTheme } from "@/app/theme-provider";
import type { Locale } from "@/i18n/config";
import ActorIcon from "@/app/components/ActorIcon";
import { IconClock } from "@/app/components/PanelIcons";

// Colore "linea/asse budget AI": giallo su dark, ambra scuro in light. Tenuto
// come LITERAL hex applicato direttamente agli attributi SVG (stroke/fill) e
// agli style inline — NON via classe CSS né var(): la build (Tailwind v4 /
// Lightning CSS) prunava sia la var sia le regole .cs-budget-* → le linee
// sparivano (stroke=none). Un hex letterale nel bundle JS non è prunabile.
// ⚠️ NON spostare questo colore nel CSS (classi o var): è proprio ciò che si
// rompe a ogni rebuild della pagina.
const BUDGET_LINE = { dark: "#ffd600", light: "#a16207" } as const;

const T: Record<
  Locale,
  {
    workingHours: string;
    actions: string;
    weekArcDay: string;
    budgetTooltip: (day: number, week: number) => string;
    legendActions: string;
    legendBudget: string;
    cumWeek: string;
    dayConsumption: string;
    paused: string;
    budgetExhausted: string;
    teamOff: string;
  }
> = {
  it: {
    workingHours: "Orario di lavoro",
    actions: "azioni",
    weekArcDay: "° giorno della settimana",
    budgetTooltip: (d, w) => `budget: ${d}% giorno · ${w}% settimana`,
    legendActions: "Azioni/giorno (asse sx)",
    legendBudget: "Budget % (asse dx)",
    cumWeek: "cumulato settimana",
    dayConsumption: "consumo del giorno",
    paused: "team in pausa",
    budgetExhausted: "budget esaurito",
    teamOff: "team fermo",
  },
  en: {
    workingHours: "Working hours",
    actions: "actions",
    weekArcDay: "° day of the week",
    budgetTooltip: (d, w) => `budget: ${d}% day · ${w}% week`,
    legendActions: "Actions/day (left axis)",
    legendBudget: "Budget % (right axis)",
    cumWeek: "cumulative week",
    dayConsumption: "day consumption",
    paused: "team paused",
    budgetExhausted: "budget used up",
    teamOff: "team off",
  },
  es: {
    workingHours: "Horario de trabajo",
    actions: "acciones",
    weekArcDay: ".º día de la semana",
    budgetTooltip: (d, w) => `presupuesto: ${d}% día · ${w}% semana`,
    legendActions: "Acciones/día (eje izquierdo)",
    legendBudget: "Presupuesto % (eje derecho)",
    cumWeek: "acumulado semana",
    dayConsumption: "consumo del día",
    paused: "equipo en pausa",
    budgetExhausted: "presupuesto agotado",
    teamOff: "equipo parado",
  },
  fr: {
    workingHours: "Horaires de travail",
    actions: "actions",
    weekArcDay: "ᵉ jour de la semaine",
    budgetTooltip: (d, w) => `budget : ${d}% jour · ${w}% semaine`,
    legendActions: "Actions/jour (axe gauche)",
    legendBudget: "Budget % (axe droit)",
    cumWeek: "cumulé semaine",
    dayConsumption: "consommation du jour",
    paused: "équipe en pause",
    budgetExhausted: "budget épuisé",
    teamOff: "équipe arrêtée",
  },
  de: {
    workingHours: "Arbeitszeit",
    actions: "Aktionen",
    weekArcDay: ". Tag der Woche",
    budgetTooltip: (d, w) => `Budget: ${d}% Tag · ${w}% Woche`,
    legendActions: "Aktionen/Tag (linke Achse)",
    legendBudget: "Budget % (rechte Achse)",
    cumWeek: "kumuliert Woche",
    dayConsumption: "Tagesverbrauch",
    paused: "Team pausiert",
    budgetExhausted: "Budget aufgebraucht",
    teamOff: "Team gestoppt",
  },
  hu: {
    workingHours: "Munkaidő",
    actions: "művelet",
    weekArcDay: ". nap a héten",
    budgetTooltip: (d, w) => `költségkeret: ${d}% nap · ${w}% hét`,
    legendActions: "Műveletek/nap (bal tengely)",
    legendBudget: "Költségkeret % (jobb tengely)",
    cumWeek: "halmozott hét",
    dayConsumption: "napi felhasználás",
    paused: "csapat szünetel",
    budgetExhausted: "keret kimerült",
    teamOff: "csapat leállt",
  },
  pt: {
    workingHours: "Horário de trabalho",
    actions: "ações",
    weekArcDay: "º dia da semana",
    budgetTooltip: (d, w) => `orçamento: ${d}% dia · ${w}% semana`,
    legendActions: "Ações/dia (eixo esquerdo)",
    legendBudget: "Orçamento % (eixo direito)",
    cumWeek: "acumulado semana",
    dayConsumption: "consumo do dia",
    paused: "equipa em pausa",
    budgetExhausted: "orçamento esgotado",
    teamOff: "equipa parada",
  },
};

// Il colore "budget" (theme-aware) è la const BUDGET_LINE sopra, applicata come
// LITERAL hex agli attributi SVG / style inline — vedi nota in testa al file.

function dm(day: string) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

// Posizione del giorno dentro l'arco settimanale del budget (reset giovedì):
// giovedì = 1° giorno … mercoledì = 7° (ultimo) giorno.
function weekArcDay(day: string): number {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay(); // dom=0 … sab=6
  return ((wd - 4 + 7) % 7) + 1; // giovedì (4) → 1
}

export default function WorkBudgetChart({
  usage,
  roleDaily,
  roles,
  workingHoursText,
}: {
  usage: CaseStudyUsage;
  roleDaily: TeamActivityRoleDay[];
  roles: TeamActivityRole[];
  workingHoursText?: string | null;
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

  // Asse CALENDARIO CONTINUO: ogni giorno tra il primo e l'ultimo ha il suo slot,
  // anche se il team era fermo (nessun campione budget) o idle (0 azioni). Così
  // l'asse temporale non "mente" collassando i giorni mancanti e la durata reale
  // del downtime resta visibile. I giorni senza campione budget = "off".
  const sampleByDay = new Map(usage.daily.map((u) => [u.day, u]));
  const actByDay = new Map(roleDaily.map((d) => [d.date, d.counts]));
  const span = [...new Set([...sampleByDay.keys(), ...actByDay.keys()])].sort();
  const cal: string[] = [];
  if (span.length) {
    const cursor = new Date(`${span[0]}T00:00:00Z`);
    const stop = new Date(`${span[span.length - 1]}T00:00:00Z`);
    while (cursor <= stop) {
      cal.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const days = cal.map((day) => {
    const u = sampleByDay.get(day);
    const counts = actByDay.get(day);
    const get = (r: TeamActivityRole) => counts?.[r] ?? 0;
    const total = roles.reduce((s, r) => s + get(r), 0);
    return {
      day,
      week: u?.week ?? null,
      pct: u?.pct ?? null,
      cum: u?.cum ?? null,
      hasSample: !!u,
      get,
      total,
    };
  });

  const n = Math.max(1, days.length);
  const maxActions = Math.max(1, ...days.map((d) => d.total));
  // tetto "carino" per l'asse azioni
  const axisMax = Math.ceil(maxActions / 10) * 10 || 10;

  const H = 300;
  const padL = 30;
  const padR = 34;
  const padT = 14;
  const padB = 26;
  const W = Math.max(320, w || 800);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const band = plotW / n;
  const barW = Math.min(28, band * 0.62);
  const xc = (i: number) => padL + band * (i + 0.5);
  const yL = (v: number) => padT + plotH - (v / axisMax) * plotH; // azioni
  const yR = (pct: number) => padT + plotH - (pct / 100) * plotH; // %

  // Bande di INATTIVITÀ: run di giorni consecutivi con 0 azioni (≥3 gg). Etichetta
  // data-driven sui run ≥4 gg: budget alto (≥90%) = "budget esaurito" (coast a fine
  // ciclo), altrimenti "team in pausa" (spento/idle). Rende auto-esplicativi i
  // vuoti, distinguendoli da dati mancanti.
  const gaps: { start: number; end: number; label: string | null }[] = [];
  // Giorni dentro una banda "budget esaurito" (coast): le linee budget NON le
  // attraversano — quel tratto resta vuoto (il budget è pieno, non c'è nulla da
  // mostrare).
  const coastDays = new Set<number>();
  for (let i = 0; i < days.length; ) {
    if (days[i].total === 0) {
      let j = i;
      while (j + 1 < days.length && days[j + 1].total === 0) j++;
      const len = j - i + 1;
      if (len >= 3) {
        let rep: number | null = null;
        for (let k = i; k <= j; k++) {
          const c = days[k].cum;
          if (c != null) rep = rep == null ? c : Math.max(rep, c);
        }
        const isCoast = rep != null && rep >= 90;
        if (isCoast) for (let k = i; k <= j; k++) coastDays.add(k);
        gaps.push({
          start: i,
          end: j,
          label: len >= 4 ? (isCoast ? t.budgetExhausted : t.paused) : null,
        });
      }
      i = j + 1;
    } else i++;
  }
  const drawable = (k: number) =>
    k >= 0 && k < days.length && days[k].hasSample && !coastDays.has(k);

  // Linea cumulata: spezzata per ciclo di budget (reset) E sui giorni "off" o
  // "budget esaurito" — niente segmenti finti sopra downtime/coast.
  const cumSegs: { x: number; y: number }[][] = [];
  days.forEach((d, i) => {
    if (!drawable(i)) return;
    const pt = { x: xc(i), y: yR(d.cum as number) };
    const seg = cumSegs[cumSegs.length - 1];
    if (seg && drawable(i - 1) && days[i - 1].week === d.week) seg.push(pt);
    else cumSegs.push([pt]);
  });
  // Linea consumo giornaliero: spezzata anch'essa su off/coast.
  const dailySegs: { x: number; y: number }[][] = [];
  days.forEach((d, i) => {
    if (!drawable(i)) return;
    const pt = { x: xc(i), y: yR(d.pct as number) };
    const seg = dailySegs[dailySegs.length - 1];
    if (seg && drawable(i - 1)) seg.push(pt);
    else dailySegs.push([pt]);
  });

  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(axisMax * f));
  const rightTicks = [0, 25, 50, 75, 100];
  const labelEvery = Math.ceil(n / 8);

  const hd = hover != null ? days[hover] : null;

  return (
    <div ref={wrapRef} className="relative">
      {workingHoursText && (
        <div className="mb-4 flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
          <IconClock size={13} />
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-dim)]">
            {t.workingHours}
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">
            {workingHoursText}
          </span>
        </div>
      )}

      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block" }}
      >
        {/* griglia + asse sinistro (azioni) */}
        {leftTicks.map((t) => (
          <g key={`l${t}`}>
            <line
              x1={padL}
              x2={padL + plotW}
              y1={yL(t)}
              y2={yL(t)}
              stroke="var(--color-border)"
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.5}
            />
            <text
              x={padL - 5}
              y={yL(t) + 3}
              textAnchor="end"
              fontSize={9}
              fill="var(--color-dim)"
            >
              {t}
            </text>
          </g>
        ))}
        {/* asse destro (%) */}
        {rightTicks.map((t) => (
          <text
            key={`r${t}`}
            fill={budgetColor}
            x={padL + plotW + 5}
            y={yR(t) + 3}
            textAnchor="start"
            fontSize={9}
            opacity={0.8}
          >
            {t}%
          </text>
        ))}

        {/* bande di inattività (team in pausa / budget esaurito) — dietro tutto */}
        {gaps.map((g) => {
          const x = padL + band * g.start;
          const wBand = band * (g.end - g.start + 1);
          return (
            <g key={`gap${g.start}`}>
              <rect
                x={x}
                y={padT}
                width={wBand}
                height={plotH}
                fill="var(--color-muted)"
                opacity={0.06}
              />
              {g.label && wBand > 46 && (
                <text
                  x={x + wBand / 2}
                  y={padT + 12}
                  textAnchor="middle"
                  fontSize={8.5}
                  fontStyle="italic"
                  fill="var(--color-dim)"
                >
                  {g.label}
                </text>
              )}
            </g>
          );
        })}

        {/* barre impilate: azioni per ruolo */}
        {days.map((d, i) => {
          if (d.total <= 0) return null;
          let acc = 0;
          return (
            <g key={d.day}>
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

        {/* linea: budget consumato quel giorno (tratteggiata), spezzata sui giorni off */}
        {dailySegs.map((seg, si) => (
          <polyline
            key={`day${si}`}
            stroke={budgetColor}
            points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* linea: budget cumulato settimanale (piena) */}
        {cumSegs.map((seg, si) =>
          seg.length === 1 ? (
            // punto isolato (settimana di 1 giorno tra due "off"): la polyline non
            // disegna nulla → un pallino lo rende visibile.
            <circle
              key={si}
              fill={budgetColor}
              cx={seg[0].x}
              cy={seg[0].y}
              r={1.8}
              opacity={0.95}
            />
          ) : (
            <polyline
              key={si}
              stroke={budgetColor}
              points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              strokeWidth={2}
              opacity={0.95}
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}

        {/* x labels + bande hover */}
        {days.map((d, i) => (
          <g key={`x${d.day}`}>
            {i % labelEvery === 0 && (
              <text
                x={xc(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize={8}
                fill="var(--color-dim)"
              >
                {dm(d.day)}
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
            {dm(hd.day)} · {hd.total} {t.actions}
          </div>
          <div className="text-[var(--color-dim)] mb-1">
            {weekArcDay(hd.day)}
            {t.weekArcDay}
          </div>
          {roles
            .filter((r) => hd.get(r) > 0)
            .map((r) => (
              <div key={r} className="flex items-center gap-1.5">
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
              {hd.hasSample
                ? t.budgetTooltip(
                    Math.round(hd.pct ?? 0),
                    Math.round(hd.cum ?? 0),
                  )
                : t.teamOff}
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
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-4 h-0"
            style={{ opacity: 0.7, borderTop: `2px dashed ${budgetColor}` }}
          />
          <span className="text-[10px] text-[var(--color-muted)]">
            {t.dayConsumption}
          </span>
        </span>
      </div>
    </div>
  );
}
