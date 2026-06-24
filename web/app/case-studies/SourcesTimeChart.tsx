"use client";

// Barre impilate "posizioni trovate al giorno", colore = FONTE (LinkedIn,
// Greenhouse, …). Stesso stile delle barre del grafico lavoro/budget, ma senza
// linee né asse destro: solo volume per giorno scomposto per provenienza.
// Larghezza piena (ResizeObserver), tooltip per giorno, legenda con i colori.

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
    other: string;
    companyCareers: string;
    officialCareers: string;
  }
> = {
  it: { noData: "Dato non disponibile in questo snapshot.", positions: "posizioni", other: "Altre", companyCareers: "Pagine carriera", officialCareers: "Carriere ufficiali" },
  en: { noData: "Data not available in this snapshot.", positions: "positions", other: "Other", companyCareers: "Career pages", officialCareers: "Official careers" },
  es: { noData: "Dato no disponible en esta instantánea.", positions: "posiciones", other: "Otras", companyCareers: "Páginas de empleo", officialCareers: "Carreras oficiales" },
  fr: { noData: "Donnée non disponible dans cet instantané.", positions: "postes", other: "Autres", companyCareers: "Pages carrière", officialCareers: "Carrières officielles" },
  de: { noData: "Daten in diesem Snapshot nicht verfügbar.", positions: "Stellen", other: "Andere", companyCareers: "Karriereseiten", officialCareers: "Offizielle Karriere" },
  hu: { noData: "Az adat nem érhető el ebben a pillanatképben.", positions: "pozíció", other: "Egyéb", companyCareers: "Karrieroldalak", officialCareers: "Hivatalos karrier" },
  pt: { noData: "Dado não disponível neste snapshot.", positions: "posições", other: "Outras", companyCareers: "Páginas de carreira", officialCareers: "Carreiras oficiais" },
};

function dm(day: string) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export default function SourcesTimeChart({
  daily,
  keys,
}: {
  daily: { day: string; counts: Record<string, number> }[];
  keys: string[];
}) {
  const locale = useLocale();
  const t = T[locale];
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

  const orderedKeys = orderSourceKeys(keys);
  const colorFor = (key: string, i: number) => colorForSource(key, i);
  const labelFor = (key: string) =>
    labelForSource(key, {
      other: t.other,
      companyCareers: t.companyCareers,
      officialCareers: t.officialCareers,
    });

  if (!daily.length || !orderedKeys.length) {
    return <p className="text-[11px] text-[var(--color-dim)]">{t.noData}</p>;
  }

  const days = daily.map((d) => {
    const get = (k: string) => d.counts[k] ?? 0;
    const total = orderedKeys.reduce((s, k) => s + get(k), 0);
    return { day: d.day, get, total };
  });

  const n = Math.max(1, days.length);
  const maxTotal = Math.max(1, ...days.map((d) => d.total));
  const axisMax = Math.ceil(maxTotal / 10) * 10 || 10;

  const H = 280;
  const padL = 30;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const W = Math.max(320, w || 800);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const band = plotW / n;
  const barW = Math.min(28, band * 0.62);
  const xc = (i: number) => padL + band * (i + 0.5);
  const yL = (v: number) => padT + plotH - (v / axisMax) * plotH;

  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(axisMax * f));
  const labelEvery = Math.ceil(n / 8);
  const hd = hover != null ? days[hover] : null;

  return (
    <div ref={wrapRef} className="relative">
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

        {/* barre impilate per fonte */}
        {days.map((d, i) => {
          if (d.total <= 0) return null;
          let acc = 0;
          return (
            <g key={d.day}>
              {orderedKeys.map((k, ki) => {
                const c = d.get(k);
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
                    fill={colorFor(k, ki)}
                    opacity={0.9}
                    rx={1}
                  />
                );
              })}
            </g>
          );
        })}

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
            minWidth: 150,
          }}
        >
          <div className="font-bold text-[var(--color-white)] mb-1">
            {dm(hd.day)} · {hd.total} {t.positions}
          </div>
          {orderedKeys
            .filter((k) => hd.get(k) > 0)
            .map((k, ki) => (
              <div key={k} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-sm"
                  style={{ background: colorFor(k, ki) }}
                />
                <span className="text-[var(--color-muted)]">
                  {labelFor(k)}: {hd.get(k)}
                </span>
              </div>
            ))}
        </div>
      )}

      {/* legenda */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] pt-3">
        {orderedKeys.map((k, ki) => (
          <span key={k} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: colorFor(k, ki) }}
            />
            <span className="text-[10px] text-[var(--color-muted)]">
              {labelFor(k)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
