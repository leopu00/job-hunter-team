"use client";

// Vetrina pubblica del case study: le sezioni "ricche" (match, geografia,
// categorie). Tutto da dati aggregati e anonimi dello snapshot. Tooltip isolato
// condiviso (ChartTooltip) → nessun jitter all'hover.

import { useMemo, useRef } from "react";
import type { CaseStudyRun } from "@/lib/case-study";
import {
  TooltipLayer,
  type TipRow,
  type TooltipHandle,
} from "@/app/components/ChartTooltip";
import europeOutline from "@/data/case-studies/europe-outline.json";
import ScoreDistribution from "@/app/components/ScoreDistribution";

const BLUE = "#2196f3";
const GREEN = "#00e676";
const DIM = "#3a4a5a";
const CAT_COLORS = [
  "#2196f3",
  "#00e676",
  "#b388ff",
  "#ffd600",
  "#ff6ac1",
  "#26c6da",
  "#ff9800",
  "#9ccc65",
  "#7e57c2",
  "#4dd0e1",
];

// ISO2 → emoji bandiera.
function flag(cc: string): string {
  const c = (cc || "").toUpperCase();
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return "🏳️";
  return String.fromCodePoint(
    ...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

function nf(n: number): string {
  return n.toLocaleString("it-IT");
}

/* ── Proiezione Europa (bounding box, equirettangolare) ───────────── */
const EU = { lonMin: -11, lonMax: 31, latMin: 34, latMax: 63 };
function projectEU(lat: number, lon: number, w: number, h: number) {
  const x = ((lon - EU.lonMin) / (EU.lonMax - EU.lonMin)) * w;
  const y = ((EU.latMax - lat) / (EU.latMax - EU.latMin)) * h;
  return { x, y };
}

export default function CaseStudyOverview({ run }: { run: CaseStudyRun }) {
  const tipRef = useRef<TooltipHandle>(null);
  const showTip = (e: React.MouseEvent, title: string, rows: TipRow[]) =>
    tipRef.current?.show(e.clientX, e.clientY, title, rows);
  const moveTip = (e: React.MouseEvent) =>
    tipRef.current?.move(e.clientX, e.clientY);
  const hideTip = () => tipRef.current?.hide();

  const { match, cities, countries, categories } = run;

  // ── Categorie: top 8 + "Altre" ──
  const catView = useMemo(() => {
    const sorted = [...categories].sort((a, b) => b.count - a.count);
    const top = sorted.slice(0, 8);
    const restN = sorted.slice(8).reduce((s, c) => s + c.count, 0);
    const items = top.map((c, i) => ({
      name: c.name,
      count: c.count,
      color: CAT_COLORS[i % CAT_COLORS.length],
    }));
    if (restN > 0)
      items.push({
        name: `Altre ${sorted.length - 8} categorie`,
        count: restN,
        color: DIM,
      });
    const total = items.reduce((s, c) => s + c.count, 0) || 1;
    return { items, total };
  }, [categories]);

  // ── Distribuzione score: max per scalare le barre ──
  const maxCity = Math.max(1, ...cities.map((c) => c.count));
  const maxCountry = Math.max(1, ...countries.map((c) => c.count));
  const topCountries = countries.slice(0, 8);
  const mapW = 520;
  const mapH = 540;

  // Coste europee (outline pre-semplificato) proiettate sullo stesso box.
  const landPaths = useMemo(
    () =>
      (europeOutline.rings as number[][][]).map(
        (ring) =>
          ring
            .map(([lon, lat], i) => {
              const { x, y } = projectEU(lat, lon, mapW, mapH);
              return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ") + " Z",
      ),
    [mapW, mapH],
  );

  // Etichette città (solo le grandi) con anti-collisione verticale: se due
  // cadono vicine (es. Zurigo/Ginevra), la seconda va sotto la bolla.
  const cityLabels = useMemo(() => {
    const labeled = cities
      .filter((c) => c.count >= 14)
      .sort((a, b) => b.count - a.count);
    const placed: { x: number; y: number }[] = [];
    const collide = (x: number, y: number) =>
      placed.some((p) => Math.abs(p.x - x) < 56 && Math.abs(p.y - y) < 13);
    return labeled.map((c) => {
      const { x, y } = projectEU(c.lat, c.lon, mapW, mapH);
      const r = 4 + 22 * Math.sqrt(c.count / maxCity);
      let ly = y - r - 4;
      if (collide(x, ly)) ly = y + r + 12;
      if (collide(x, ly)) ly = y - r - 17;
      placed.push({ x, y: ly });
      return { city: c.city, x, y: ly };
    });
  }, [cities, maxCity, mapW, mapH]);

  // Donut categorie (archi)
  const R = 62;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = catView.items.map((it) => {
    const frac = it.count / catView.total;
    const a = { ...it, frac, start: acc, pct: Math.round(frac * 100) };
    acc += frac;
    return a;
  });

  return (
    <div className="flex flex-col gap-12">
      {/* ════════ IL MATCH ═══════════════════════════ (order-2) ═══ */}
      <section className="order-2">
        <div className="section-label mb-1">🎯 Quanto bene ti trova lavoro</div>
        <p className="text-[11px] text-[var(--color-dim)] mb-4">
          Ogni posizione viene valutata 0–100 su quanto calza al profilo del
          candidato. Più alto è il punteggio, più forte è il match.
        </p>

        {/* Callout sintetici */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
            <div className="text-2xl sm:text-3xl font-extrabold tabular-nums leading-none">
              {Math.round(match.avg)}
              <span className="text-[var(--color-dim)] text-base font-bold">
                /100
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)] mt-1">
              match medio · {nf(match.scored)} valutate
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
            <div
              className="text-2xl sm:text-3xl font-extrabold tabular-nums leading-none"
              style={{ color: GREEN }}
            >
              {nf(match.strong70)}
              <span className="text-[var(--color-dim)] text-base font-bold">
                {" "}
                ·{" "}
                {Math.round((match.strong70 / Math.max(1, match.scored)) * 100)}
                %
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)] mt-1">
              match forti · score ≥ 70
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
            <div
              className="text-2xl sm:text-3xl font-extrabold tabular-nums leading-none"
              style={{ color: GREEN }}
            >
              {nf(match.strong80)}
              <span className="text-[var(--color-dim)] text-base font-bold">
                {" "}
                ·{" "}
                {Math.round((match.strong80 / Math.max(1, match.scored)) * 100)}
                %
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)] mt-1">
              eccellenti · score ≥ 80
            </div>
          </div>
        </div>

        {/* Istogramma punteggi (stesso grafico della dashboard) */}
        <ScoreDistribution
          scores={match.scores}
          title="Distribuzione dei punteggi"
          emptyLabel="Nessun punteggio disponibile"
          thresholdReady={70}
          thresholdLabel="match forti ≥70"
        />
      </section>

      {/* ════════ DOVE — MAPPA EUROPA ════════════════ (order-1) ═══ */}
      <section className="order-1">
        <div className="section-label mb-1">🗺️ Dove cerca lavoro · Europa</div>
        <p className="text-[11px] text-[var(--color-dim)] mb-4">
          {nf(cities.reduce((s, c) => s + c.count, 0))} posizioni geolocalizzate
          in{" "}
          <strong className="text-[var(--color-muted)]">
            {countries.length} paesi
          </strong>{" "}
          e{" "}
          <strong className="text-[var(--color-muted)]">
            {cities.length} città
          </strong>
          . La dimensione del cerchio = numero di posizioni. Solo posizioni{" "}
          <strong className="text-[var(--color-muted)]">
            verificate e lavorabili
          </strong>{" "}
          per il candidato (escluse quelle non compatibili con i requisiti di
          lavoro, es. cittadinanza/visto).
        </p>

        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-5 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-center">
          {/* Mappa a bolle */}
          <div className="overflow-hidden">
            <svg
              viewBox={`0 0 ${mapW} ${mapH}`}
              width="100%"
              style={{ maxHeight: 520 }}
              preserveAspectRatio="xMidYMid meet"
            >
              {/* terra · coste Europa (outline reale semplificato) */}
              {landPaths.map((d, i) => (
                <path
                  key={`land${i}`}
                  d={d}
                  fill="color-mix(in srgb, var(--color-muted) 8%, transparent)"
                  stroke="color-mix(in srgb, var(--color-muted) 42%, transparent)"
                  strokeWidth={0.7}
                  strokeLinejoin="round"
                />
              ))}
              {/* graticola (tenue) */}
              {[-10, 0, 10, 20, 30].map((lon) => {
                const { x } = projectEU(50, lon, mapW, mapH);
                return (
                  <line
                    key={`v${lon}`}
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={mapH}
                    stroke="var(--color-border)"
                    strokeWidth={0.5}
                    opacity={0.18}
                  />
                );
              })}
              {[40, 45, 50, 55, 60].map((lat) => {
                const { y } = projectEU(lat, 0, mapW, mapH);
                return (
                  <line
                    key={`h${lat}`}
                    x1={0}
                    x2={mapW}
                    y1={y}
                    y2={y}
                    stroke="var(--color-border)"
                    strokeWidth={0.5}
                    opacity={0.18}
                  />
                );
              })}
              {/* bolle (grandi sotto, così le etichette restano leggibili) */}
              {[...cities]
                .sort((a, b) => b.count - a.count)
                .map((c) => {
                  const { x, y } = projectEU(c.lat, c.lon, mapW, mapH);
                  const r = 4 + 22 * Math.sqrt(c.count / maxCity);
                  return (
                    <circle
                      key={`${c.city}-${c.lat}`}
                      cx={x}
                      cy={y}
                      r={r}
                      fill={BLUE}
                      fillOpacity={0.4}
                      stroke={BLUE}
                      strokeOpacity={0.95}
                      strokeWidth={1.2}
                      className="cursor-default"
                      onMouseEnter={(e) =>
                        showTip(
                          e,
                          `${c.city}${c.country ? " · " + c.country : ""}`,
                          [
                            {
                              color: BLUE,
                              label: "posizioni",
                              value: nf(c.count),
                            },
                          ],
                        )
                      }
                      onMouseMove={moveTip}
                      onMouseLeave={hideTip}
                    />
                  );
                })}
              {/* etichette: solo le città grandi, con alone scuro per leggibilità */}
              {cityLabels.map((l) => (
                <text
                  key={`l${l.city}`}
                  x={l.x}
                  y={l.y}
                  textAnchor="middle"
                  className="fill-[var(--color-white)] pointer-events-none"
                  style={
                    {
                      fontSize: 10,
                      fontWeight: 700,
                      paintOrder: "stroke",
                      stroke: "var(--color-panel)",
                      strokeWidth: 3,
                    } as React.CSSProperties
                  }
                >
                  {l.city}
                </text>
              ))}
            </svg>
          </div>

          {/* Top paesi */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)] mb-3">
              Top paesi
            </div>
            <div className="space-y-2">
              {topCountries.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center gap-2.5"
                  onMouseEnter={(e) =>
                    showTip(e, `${flag(c.code)} ${c.name}`, [
                      { color: BLUE, label: "posizioni", value: nf(c.count) },
                    ])
                  }
                  onMouseMove={moveTip}
                  onMouseLeave={hideTip}
                >
                  <span className="text-[13px] w-5 shrink-0 text-center">
                    {flag(c.code)}
                  </span>
                  <span className="text-[11px] text-[var(--color-muted)] w-24 shrink-0 truncate">
                    {c.name}
                  </span>
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: "var(--color-border)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(c.count / maxCountry) * 100}%`,
                        background: BLUE,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <span
                    className="text-[11px] font-bold tabular-nums w-7 text-right"
                    style={{ color: BLUE }}
                  >
                    {c.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════════ CATEGORIE — DONUT ══════════════════ (order-3) ═══ */}
      <section className="order-3">
        <div className="section-label mb-1">🧩 Che tipo di ruoli</div>
        <p className="text-[11px] text-[var(--color-dim)] mb-4">
          {categories.length} categorie di ruolo emerse automaticamente dai
          dati, senza liste predefinite — il team capisce da solo che tipo di
          lavoro fa per te.
        </p>

        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-8 items-center">
          {/* Donut */}
          <div
            className="relative shrink-0 mx-auto"
            style={{ width: 180, height: 180 }}
          >
            <svg viewBox="0 0 180 180" width={180} height={180}>
              <g transform="rotate(-90 90 90)">
                {arcs.map((s) => (
                  <circle
                    key={s.name}
                    cx={90}
                    cy={90}
                    r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={24}
                    strokeDasharray={`${s.frac * C} ${C - s.frac * C}`}
                    strokeDashoffset={-s.start * C}
                    className="cursor-default"
                    onMouseEnter={(e) =>
                      showTip(e, s.name, [
                        {
                          color: s.color,
                          label: `${s.pct}% · posizioni`,
                          value: nf(s.count),
                        },
                      ])
                    }
                    onMouseMove={moveTip}
                    onMouseLeave={hideTip}
                  />
                ))}
              </g>
              <text
                x={90}
                y={90}
                textAnchor="middle"
                style={{ fontSize: 38, fontWeight: 800, fill: BLUE }}
              >
                {nf(run.totals.positions)}
              </text>
              <text
                x={90}
                y={108}
                textAnchor="middle"
                className="fill-[var(--color-dim)]"
                style={{ fontSize: 8, letterSpacing: 0.5 }}
              >
                POSIZIONI TROVATE
              </text>
            </svg>
          </div>
          {/* Legenda */}
          <div className="w-full space-y-2">
            {arcs.map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-3"
                onMouseEnter={(e) =>
                  showTip(e, s.name, [
                    {
                      color: s.color,
                      label: `${s.pct}% · posizioni`,
                      value: nf(s.count),
                    },
                  ])
                }
                onMouseMove={moveTip}
                onMouseLeave={hideTip}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: s.color }}
                />
                <span
                  className="text-[11px] text-[var(--color-muted)] flex-1 truncate"
                  title={s.name}
                >
                  {s.name}
                </span>
                <div
                  className="w-24 h-1.5 rounded-full overflow-hidden shrink-0"
                  style={{ background: "var(--color-border)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${s.frac * 100}%`,
                      background: s.color,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span className="text-[11px] font-bold tabular-nums w-7 text-right shrink-0">
                  {s.pct}%
                </span>
                <span className="text-[10px] text-[var(--color-dim)] tabular-nums w-8 text-right shrink-0">
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <TooltipLayer ref={tipRef} />
    </div>
  );
}
