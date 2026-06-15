"use client";

// Mockup grafico della dashboard — interamente in SVG/CSS, sfondo
// trasparente. Card flottanti in prospettiva 3D (preserve-3d + translateZ)
// che "escono dal frame". Elementi a tema ricerca-lavoro (NON trading):
// lista di posizioni con punteggi, barre, donut e mini-andamento. Niente
// testo finto/leggibile (finte etichette = barrette grigie). Rispetta
// prefers-reduced-motion.

const GREEN = "var(--color-green)";
const CYAN = "#22d3ee";
const INDIGO = "#818cf8";
const SLATE = "#64748b";

type Seg = { value: number; color: string };

function Donut({
  segments,
  thickness = 15,
  track = true,
}: {
  segments: Seg[];
  thickness?: number;
  track?: boolean;
}) {
  const size = 100;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  return (
    <svg
      viewBox="0 0 100 100"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
      aria-hidden="true"
    >
      <g transform="rotate(-90 50 50)">
        {track && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={thickness}
            opacity="0.4"
          />
        )}
        {segments.map((s, i) => {
          const frac = s.value / total;
          const len = Math.max(0, frac * c - 2);
          const node = (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-acc}
              strokeLinecap="round"
            />
          );
          acc += frac * c;
          return node;
        })}
      </g>
    </svg>
  );
}

// Finta etichetta: barretta grigia arrotondata (suggerisce testo senza parole).
function Label({ w = 40, faint = false }: { w?: number; faint?: boolean }) {
  return (
    <span
      className="block h-1.5 rounded-full"
      style={{
        width: `${w}px`,
        background: faint ? "var(--color-border)" : "var(--color-muted)",
        opacity: faint ? 0.6 : 0.5,
      }}
    />
  );
}

// Lista di posizioni trovate: pallino-stato + finte righe di testo + punteggio.
function PositionsList() {
  const rows = [
    { score: 94, color: GREEN, t: 84, s: 48 },
    { score: 88, color: GREEN, t: 68, s: 54 },
    { score: 81, color: CYAN, t: 76, s: 42 },
    { score: 73, color: SLATE, t: 60, s: 50 },
  ];
  return (
    <div className="flex flex-col justify-between h-full py-0.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: r.color }}
          />
          <div className="flex flex-col gap-1.5 flex-1">
            <Label w={r.t} />
            <Label w={r.s} faint />
          </div>
          <span
            className="text-[clamp(10px,1.5vw,13px)] font-bold tabular-nums"
            style={{ color: r.color }}
          >
            {r.score}
          </span>
        </div>
      ))}
    </div>
  );
}

// Barre verticali — es. posizioni trovate per periodo. Ultima evidenziata.
function VBars() {
  const bars = [0.42, 0.56, 0.46, 0.68, 0.58, 0.8, 0.7, 0.96];
  return (
    <div className="flex items-end justify-between gap-1.5 h-full">
      {bars.map((h, i) => {
        const last = i === bars.length - 1;
        return (
          <span
            key={i}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${h * 100}%`,
              background: last ? GREEN : "var(--color-muted)",
              opacity: last ? 1 : 0.5,
            }}
          />
        );
      })}
    </div>
  );
}

// Mini andamento (sparkline) crescente.
function Sparkline() {
  const pts: [number, number][] = [
    [0, 16],
    [20, 11],
    [40, 13],
    [60, 7],
    [80, 9],
    [100, 3],
  ];
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  return (
    <svg
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
      aria-hidden="true"
    >
      <path
        d={line}
        fill="none"
        stroke="var(--color-green)"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const cardBase =
  "absolute rounded-2xl border border-[var(--color-border)] shadow-[0_24px_60px_rgba(0,0,0,0.55)]";

export default function DashboardMockup() {
  return (
    <div
      className="relative w-full select-none"
      style={{ aspectRatio: "16 / 9" }}
      role="img"
      aria-label="Anteprima della dashboard: lista di posizioni con punteggi, barre, donut e andamento"
    >
      <style>{`
        @keyframes dashFloatA { from { transform: translateY(0) } to { transform: translateY(-10px) } }
        @keyframes dashFloatB { from { transform: translateY(0) } to { transform: translateY(8px) } }
        @media (prefers-reduced-motion: reduce) {
          .dash-float-a, .dash-float-b { animation: none !important }
        }
      `}</style>

      <div className="absolute inset-0" style={{ perspective: "1300px" }}>
        <div
          className="absolute inset-0"
          style={{
            transformStyle: "preserve-3d",
            transform: "rotateY(-15deg) rotateX(7deg)",
          }}
        >
          {/* Glow verde dietro il donut focale */}
          <div
            aria-hidden="true"
            className="absolute rounded-full"
            style={{
              right: "2%",
              top: "-10%",
              width: "46%",
              height: "70%",
              background:
                "radial-gradient(circle, rgba(0,232,122,0.22) 0%, transparent 68%)",
              transform: "translateZ(20px)",
              filter: "blur(6px)",
            }}
          />

          {/* Card principale: LISTA POSIZIONI */}
          <div
            className={`${cardBase} flex flex-col p-5`}
            style={{
              left: "0%",
              bottom: "3%",
              width: "56%",
              height: "66%",
              background: "var(--color-panel)",
              transform: "translateZ(0px)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <Label w={60} />
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: GREEN }}
              />
            </div>
            <div className="flex-1 min-h-0">
              <PositionsList />
            </div>
          </div>

          {/* Card: BARRE verticali */}
          <div
            className={`${cardBase} dash-float-b flex flex-col p-5`}
            style={{
              right: "0%",
              bottom: "6%",
              width: "40%",
              height: "42%",
              background: "var(--color-card)",
              transform: "translateZ(45px)",
              animation: "dashFloatB 5s ease-in-out infinite alternate",
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Label w={36} />
              <span
                className="ml-auto inline-block w-2 h-2 rounded-full"
                style={{ background: GREEN }}
              />
            </div>
            <div className="flex-1 min-h-0">
              <VBars />
            </div>
          </div>

          {/* Donut focale che esce dal frame */}
          <div
            className="dash-float-a absolute"
            style={{
              right: "4%",
              top: "-8%",
              width: "38%",
              height: "58%",
              transform: "translateZ(95px)",
              filter: "drop-shadow(0 18px 40px rgba(0,0,0,0.5))",
              animation: "dashFloatA 6s ease-in-out infinite alternate",
            }}
          >
            <div className="relative w-full h-full">
              <Donut
                segments={[
                  { value: 72, color: GREEN },
                  { value: 28, color: "var(--color-border)" },
                ]}
                track={false}
                thickness={12}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[clamp(18px,3.4vw,34px)] font-extrabold tracking-tight text-[var(--color-white)] leading-none">
                  72<span className="text-[var(--color-green)]">%</span>
                </span>
                <span className="mt-2">
                  <Label w={30} faint />
                </span>
              </div>
            </div>
          </div>

          {/* Chip piccola: mini-andamento */}
          <div
            className={`${cardBase} flex items-center gap-3 px-4 py-3`}
            style={{
              left: "8%",
              top: "-4%",
              width: "32%",
              maxWidth: 200,
              background: "var(--color-panel)",
              transform: "translateZ(65px)",
            }}
          >
            <div className="flex flex-col gap-1.5 flex-1">
              <Label w={46} />
              <Label w={30} faint />
            </div>
            <div className="w-12 h-6 shrink-0">
              <Sparkline />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
