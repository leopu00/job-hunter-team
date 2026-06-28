"use client";

// Doppio asse Y, per FONTE:
//  - barre impilate = posizioni trovate al giorno (asse sx, conteggio)
//  - una linea per fonte = score medio giornaliero di quella fonte (asse dx, 0-100)
// Stesso colore per barra e linea di una fonte. Le linee si spezzano nei giorni
// senza posizioni scorate; i punti isolati restano visibili come pallini.

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import {
  colorForSource,
  labelForSource,
  orderSourceKeys,
} from "@/lib/case-study-sources";

const T: Record<
  Locale,
  {
    noData: string;
    positions: string;
    score: string;
    other: string;
    companyCareers: string;
    officialCareers: string;
    legendBars: string;
    legendLines: string;
    scoreToggle: string;
  }
> = {
  it: {
    noData: "Dato non disponibile in questo snapshot.",
    positions: "pos.",
    score: "score",
    other: "Altre",
    companyCareers: "Pagine carriera",
    officialCareers: "Carriere ufficiali",
    legendBars: "Barre = posizioni/giorno",
    legendLines: "Linee = score medio (asse dx)",
    scoreToggle: "Score medio",
  },
  en: {
    noData: "Data not available in this snapshot.",
    positions: "pos.",
    score: "score",
    other: "Other",
    companyCareers: "Career pages",
    officialCareers: "Official careers",
    legendBars: "Bars = positions/day",
    legendLines: "Lines = average score (right axis)",
    scoreToggle: "Average score",
  },
  es: {
    noData: "Dato no disponible en esta instantánea.",
    positions: "pos.",
    score: "score",
    other: "Otras",
    companyCareers: "Páginas de empleo",
    officialCareers: "Carreras oficiales",
    legendBars: "Barras = posiciones/día",
    legendLines: "Líneas = score medio (eje derecho)",
    scoreToggle: "Score medio",
  },
  fr: {
    noData: "Donnée non disponible dans cet instantané.",
    positions: "postes",
    score: "score",
    other: "Autres",
    companyCareers: "Pages carrière",
    officialCareers: "Carrières officielles",
    legendBars: "Barres = postes/jour",
    legendLines: "Lignes = score moyen (axe droit)",
    scoreToggle: "Score moyen",
  },
  de: {
    noData: "Daten in diesem Snapshot nicht verfügbar.",
    positions: "Stellen",
    score: "Score",
    other: "Andere",
    companyCareers: "Karriereseiten",
    officialCareers: "Offizielle Karriere",
    legendBars: "Balken = Stellen/Tag",
    legendLines: "Linien = Durchschnitts-Score (rechte Achse)",
    scoreToggle: "Durchschnitts-Score",
  },
  hu: {
    noData: "Az adat nem érhető el ebben a pillanatképben.",
    positions: "poz.",
    score: "pontszám",
    other: "Egyéb",
    companyCareers: "Karrieroldalak",
    officialCareers: "Hivatalos karrier",
    legendBars: "Oszlopok = pozíció/nap",
    legendLines: "Vonalak = átlagpontszám (jobb tengely)",
    scoreToggle: "Átlagpontszám",
  },
  pt: {
    noData: "Dado não disponível neste snapshot.",
    positions: "pos.",
    score: "score",
    other: "Outras",
    companyCareers: "Páginas de carreira",
    officialCareers: "Carreiras oficiais",
    legendBars: "Barras = posições/dia",
    legendLines: "Linhas = score médio (eixo direito)",
    scoreToggle: "Score médio",
  },
};

function dm(day: string) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export default function SourcesScoreChart({
  daily,
  scoreDaily,
  keys,
}: {
  daily: { day: string; counts: Record<string, number> }[];
  scoreDaily: { day: string; score: Record<string, number> }[];
  keys: string[];
}) {
  const locale = useLocale();
  const t = T[locale];
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  // Filtro fonti via legenda: vuoto = tutte; altrimenti solo le selezionate.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Linee score on/off. OFF → niente linee/asse dx, barre a colore pieno.
  const [showScore, setShowScore] = useState(true);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const u = () => setW(el.clientWidth);
    u();
    const ro = new ResizeObserver(u);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const orderedKeys = orderSourceKeys(keys);
  const labelFor = (key: string) =>
    labelForSource(key, {
      other: t.other,
      companyCareers: t.companyCareers,
      officialCareers: t.officialCareers,
    });
  // Colore stabile per fonte (indice fisso in orderedKeys, non cambia col filtro).
  const col = (key: string) => colorForSource(key, orderedKeys.indexOf(key));
  const filtering = selected.size > 0;
  const isVisible = (key: string) => !filtering || selected.has(key);
  const visibleKeys = orderedKeys.filter(isVisible);
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (!daily.length || !orderedKeys.length) {
    return <p className="text-[11px] text-[var(--color-dim)]">{t.noData}</p>;
  }

  const scoreByDay = new Map(scoreDaily.map((d) => [d.day, d.score]));
  const days = daily.map((d) => {
    const counts = d.counts;
    const score = scoreByDay.get(d.day) ?? {};
    const total = visibleKeys.reduce((s, k) => s + (counts[k] ?? 0), 0);
    return { day: d.day, counts, score, total };
  });

  const n = Math.max(1, days.length);
  const maxTotal = Math.max(1, ...days.map((d) => d.total));
  const axisMax = Math.ceil(maxTotal / 10) * 10 || 10;

  const H = 440;
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
  const yL = (v: number) => padT + plotH - (v / axisMax) * plotH; // posizioni
  const yR = (s: number) => padT + plotH - (s / 100) * plotH; // score %

  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(axisMax * f));
  const rightTicks = [0, 25, 50, 75, 100];
  const labelEvery = Math.ceil(n / 8);
  const hd = hover != null ? days[hover] : null;

  // Linee score per fonte (solo visibili): segmenti spezzati sui giorni senza dato.
  const lines = visibleKeys.map((key) => {
    const segs: { x: number; y: number }[][] = [];
    const dots: { x: number; y: number }[] = [];
    days.forEach((d, i) => {
      const v = d.score[key];
      if (v == null) return;
      const pt = { x: xc(i), y: yR(v) };
      dots.push(pt);
      const prevHas = i > 0 && days[i - 1].score[key] != null;
      const last = segs[segs.length - 1];
      if (last && prevHas) last.push(pt);
      else segs.push([pt]);
    });
    return { key, color: col(key), segs, dots };
  });

  return (
    <div ref={wrapRef} className="relative">
      {/* interruttore linee score */}
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={() => setShowScore((s) => !s)}
          aria-pressed={showScore}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[var(--color-muted)] cursor-pointer transition-opacity hover:opacity-80"
          style={{ opacity: showScore ? 1 : 0.6 }}
        >
          <span aria-hidden>{showScore ? "●" : "○"}</span>
          {t.scoreToggle}
        </button>
      </div>

      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block" }}
      >
        {/* griglia + asse sinistro (posizioni) */}
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
        {/* asse destro (score %) — solo con linee attive */}
        {showScore &&
          rightTicks.map((tk) => (
            <text
              key={`r${tk}`}
              x={padL + plotW + 5}
              y={yR(tk) + 3}
              textAnchor="start"
              fontSize={9}
              fill="var(--color-dim)"
            >
              {tk}
            </text>
          ))}

        {/* barre impilate per fonte */}
        {days.map((d, i) => {
          if (d.total <= 0) return null;
          let acc = 0;
          return (
            <g key={d.day}>
              {visibleKeys.map((k) => {
                const c = d.counts[k] ?? 0;
                if (c <= 0) return null;
                const h = (c / axisMax) * plotH;
                const y = padT + plotH - (acc / axisMax) * plotH - h;
                acc += c;
                return (
                  <rect
                    key={k}
                    x={xc(i) - barW / 2}
                    y={y}
                    width={barW}
                    height={h}
                    fill={col(k)}
                    opacity={showScore ? 0.32 : 0.9}
                    rx={1}
                  />
                );
              })}
            </g>
          );
        })}

        {/* linee score per fonte (sopra le barre, più marcate) */}
        {showScore &&
          lines.map((ln) => (
            <g key={`ln${ln.key}`}>
              {ln.segs.map((seg, si) => (
                <polyline
                  key={si}
                  points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={ln.color}
                  strokeWidth={1.75}
                  opacity={0.9}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {ln.dots.map((p, di) => (
                <circle
                  key={di}
                  cx={p.x}
                  cy={p.y}
                  r={2}
                  fill={ln.color}
                  opacity={0.95}
                />
              ))}
            </g>
          ))}

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
      {hd && hd.total > 0 && (
        <div
          className="absolute z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[10px] shadow-xl pointer-events-none"
          style={{
            left: `${(xc(hover!) / W) * 100}%`,
            top: 0,
            transform: "translateX(-50%)",
            minWidth: 170,
          }}
        >
          <div className="font-bold text-[var(--color-white)] mb-1">
            {dm(hd.day)} · {hd.total} {t.positions}
          </div>
          {visibleKeys
            .filter((k) => (hd.counts[k] ?? 0) > 0)
            .map((k) => {
              const sc = hd.score[k];
              return (
                <div key={k} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ background: col(k) }}
                  />
                  <span className="text-[var(--color-muted)]">
                    {labelFor(k)}: {hd.counts[k]} {t.positions}
                    {showScore && sc != null && ` · ${t.score} ${sc}`}
                  </span>
                </div>
              );
            })}
        </div>
      )}

      {/* legenda */}
      <div className="mt-4 border-t border-[var(--color-border)] pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {orderedKeys.map((k) => {
            const dim = filtering && !selected.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k)}
                aria-pressed={selected.has(k)}
                className="flex items-center gap-1.5 cursor-pointer transition-opacity"
                style={{ opacity: dim ? 0.35 : 1 }}
                title={labelFor(k)}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: col(k) }}
                />
                <span className="text-[10px] text-[var(--color-muted)]">
                  {labelFor(k)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
          {showScore ? `${t.legendBars} · ${t.legendLines}` : t.legendBars}
        </div>
      </div>
    </div>
  );
}
