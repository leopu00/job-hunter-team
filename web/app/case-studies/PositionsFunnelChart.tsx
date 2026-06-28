"use client";

// Proporzione TROVATE → TENUTE / ESCLUSE, giorno per giorno. Grafico "a candela"
// divergente: per ogni giorno le posizioni TENUTE salgono sopra lo zero (verde) e
// le ESCLUSE scendono sotto (rosso) — stessa scala su e giù, così l'altezza totale
// di ogni candela = posizioni trovate quel giorno e la proporzione si legge a vista.

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const KEPT = "#22C55E";
const EXCL = "#EF4444";

const T: Record<
  Locale,
  {
    noData: string;
    found: string;
    kept: string;
    excluded: string;
    legendKept: string;
    legendExcl: string;
    pctExcl: (p: number) => string;
  }
> = {
  it: { noData: "Dato non disponibile.", found: "trovate", kept: "tenute", excluded: "escluse", legendKept: "Tenute (non escluse)", legendExcl: "Escluse", pctExcl: (p) => `${p}% escluse` },
  en: { noData: "Data not available.", found: "found", kept: "kept", excluded: "excluded", legendKept: "Kept (not excluded)", legendExcl: "Excluded", pctExcl: (p) => `${p}% excluded` },
  es: { noData: "Dato no disponible.", found: "encontradas", kept: "conservadas", excluded: "excluidas", legendKept: "Conservadas (no excluidas)", legendExcl: "Excluidas", pctExcl: (p) => `${p}% excluidas` },
  fr: { noData: "Donnée non disponible.", found: "trouvées", kept: "conservées", excluded: "exclues", legendKept: "Conservées (non exclues)", legendExcl: "Exclues", pctExcl: (p) => `${p}% exclues` },
  de: { noData: "Daten nicht verfügbar.", found: "gefunden", kept: "behalten", excluded: "ausgeschlossen", legendKept: "Behalten (nicht ausgeschlossen)", legendExcl: "Ausgeschlossen", pctExcl: (p) => `${p}% ausgeschlossen` },
  hu: { noData: "Az adat nem érhető el.", found: "találat", kept: "megtartott", excluded: "kizárt", legendKept: "Megtartott (nem kizárt)", legendExcl: "Kizárt", pctExcl: (p) => `${p}% kizárt` },
  pt: { noData: "Dado não disponível.", found: "encontradas", kept: "mantidas", excluded: "excluídas", legendKept: "Mantidas (não excluídas)", legendExcl: "Excluídas", pctExcl: (p) => `${p}% excluídas` },
};

function dm(day: string) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export default function PositionsFunnelChart({
  daily,
}: {
  daily: { day: string; found: number; excluded: number; kept: number }[];
}) {
  const locale = useLocale();
  const t = T[locale];
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hgt, setHgt] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const u = () => {
      setW(el.clientWidth);
      if (svgWrapRef.current) setHgt(svgWrapRef.current.clientHeight);
    };
    u();
    const ro = new ResizeObserver(u);
    ro.observe(el);
    if (svgWrapRef.current) ro.observe(svgWrapRef.current);
    return () => ro.disconnect();
  }, []);

  if (!daily.length) {
    return <p className="text-[11px] text-[var(--color-dim)]">{t.noData}</p>;
  }

  const maxUp = Math.max(1, ...daily.map((d) => d.kept));
  const maxDown = Math.max(1, ...daily.map((d) => d.excluded));
  const span = maxUp + maxDown;

  const H = Math.max(240, hgt || 360); // riempie l'altezza della card
  const padL = 28;
  const padR = 14;
  const padT = 16;
  const padB = 26;
  const W = Math.max(320, w || 800);
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = daily.length;
  const band = plotW / n;
  const barW = Math.min(26, band * 0.6);
  const xc = (i: number) => padL + band * (i + 0.5);
  const unit = plotH / span; // px per posizione (stessa scala su/giù)
  const yZero = padT + maxUp * unit; // linea dello zero

  const labelEvery = Math.ceil(n / 8);
  const hd = hover != null ? daily[hover] : null;

  return (
    <div ref={wrapRef} className="relative flex flex-col h-full">
      <div ref={svgWrapRef} className="flex-1 min-h-0" style={{ minHeight: 240 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        {/* tick conteggi su/giù */}
        {[maxUp, Math.round(maxUp / 2), maxDown, Math.round(maxDown / 2)].map((v, idx) => {
          const up = idx < 2;
          const y = up ? yZero - v * unit : yZero + v * unit;
          return (
            <text key={`t${idx}`} x={padL - 5} y={y + 3} textAnchor="end" fontSize={9} fill="var(--color-dim)">
              {v}
            </text>
          );
        })}
        {/* linea dello zero */}
        <line x1={padL} x2={padL + plotW} y1={yZero} y2={yZero} stroke="var(--color-border)" strokeWidth={1} opacity={0.8} />

        {/* candele: tenute su (verde), escluse giù (rosso) */}
        {daily.map((d, i) => {
          const hUp = d.kept * unit;
          const hDown = d.excluded * unit;
          const on = hover == null || hover === i;
          return (
            <g key={d.day} opacity={on ? 1 : 0.4} style={{ transition: "opacity 120ms" }}>
              {d.kept > 0 && (
                <rect x={xc(i) - barW / 2} y={yZero - hUp} width={barW} height={hUp} fill={KEPT} opacity={0.85} rx={1} />
              )}
              {d.excluded > 0 && (
                <rect x={xc(i) - barW / 2} y={yZero} width={barW} height={hDown} fill={EXCL} opacity={0.8} rx={1} />
              )}
            </g>
          );
        })}

        {/* etichette giorno + bande hover */}
        {daily.map((d, i) => (
          <g key={`x${d.day}`}>
            {i % labelEvery === 0 && (
              <text x={xc(i)} y={H - 8} textAnchor="middle" fontSize={8} fill="var(--color-dim)">{dm(d.day)}</text>
            )}
            <rect x={padL + band * i} y={padT} width={band} height={plotH} fill={hover === i ? "var(--color-muted)" : "transparent"} opacity={hover === i ? 0.06 : 0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }} />
          </g>
        ))}
      </svg>
      </div>

      {/* tooltip */}
      {hd && (
        <div className="absolute z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[10px] shadow-xl pointer-events-none" style={{ left: `${(xc(hover!) / W) * 100}%`, top: 0, transform: "translateX(-50%)", minWidth: 140 }}>
          <div className="font-bold text-[var(--color-white)]">
            {dm(hd.day)} · {hd.found} {t.found}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: KEPT }} />
            <span className="text-[var(--color-muted)]">{t.kept}: {hd.kept}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: EXCL }} />
            <span className="text-[var(--color-muted)]">{t.excluded}: {hd.excluded}</span>
          </div>
          <div className="mt-1 pt-1 border-t border-[var(--color-border)] text-[var(--color-dim)]">
            {t.pctExcl(hd.found ? Math.round((hd.excluded / hd.found) * 100) : 0)}
          </div>
        </div>
      )}

      {/* legenda */}
      <div className="mt-4 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--color-border)] pt-3">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: KEPT }} />
          <span className="text-[10px] text-[var(--color-muted)]">{t.legendKept}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: EXCL }} />
          <span className="text-[10px] text-[var(--color-muted)]">{t.legendExcl}</span>
        </span>
      </div>
    </div>
  );
}
