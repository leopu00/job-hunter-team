"use client";

import { useEffect, useMemo, useRef } from "react";

type Step = {
  key: string;
  label: string;
  count: number;
  color: string;
};

type Props = {
  steps: Step[];
  title: string;
};

const W = 800;
const H = 260;
const PAD = { top: 30, right: 32, bottom: 48, left: 32 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

// Ondulazione "mare". Ampiezza piccola in px sui control point delle
// bezier: i punti dati (dot/count) restano fermi, solo la curva fra
// loro oscilla. Period in secondi controlla la velocità — onde marine
// hanno periodo lungo, sensazione "respirante" non frenetica.
const WAVE_AMPLITUDE = 6;
const WAVE_PERIOD_S = 5.5;

// Area chart con linea smussata (Catmull-Rom → bezier cubica) che
// passa per il count di ogni stato della pipeline. La linea ondula
// in modo naturale fra i picchi; un'animazione rAF perturba i
// control point delle bezier creando un'onda viaggiante (mare calmo).
export default function PipelineFlow({ steps, title }: Props) {
  const stages = useMemo(
    () => steps.filter((s) => s.key !== "found" && s.key !== "review"),
    [steps],
  );

  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  const points = useMemo(
    () =>
      stages.map((s, i) => {
        const x = PAD.left + (INNER_W * i) / Math.max(1, stages.length - 1);
        const y = PAD.top + INNER_H * (1 - s.count / maxCount);
        return { x, y, ...s };
      }),
    [stages, maxCount],
  );

  const linePathRef = useRef<SVGPathElement>(null);
  const areaPathRef = useRef<SVGPathElement>(null);

  // Genera il path con un dato phase (radianti). Ogni segmento ha un
  // offset di fase i*0.9 → onda viaggiante da sinistra a destra.
  const buildPaths = (phase: number) => {
    if (points.length < 2) return { line: "", area: "" };
    const t = 0.22;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] ?? points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] ?? p2;
      // Catmull-Rom control points
      let cp1x = p1.x + (p2.x - p0.x) * t;
      let cp1y = p1.y + (p2.y - p0.y) * t;
      let cp2x = p2.x - (p3.x - p1.x) * t;
      let cp2y = p2.y - (p3.y - p1.y) * t;
      // Wave perturbation: solo Y, fase shiftata per segmento
      cp1y += Math.sin(phase + i * 0.9) * WAVE_AMPLITUDE;
      cp2y += Math.sin(phase + i * 0.9 + 0.5) * WAVE_AMPLITUDE;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    const baseY = PAD.top + INNER_H;
    const area = `${d} L ${points[points.length - 1].x} ${baseY} L ${points[0].x} ${baseY} Z`;
    return { line: d, area };
  };

  // Inizializza paths statici per SSR / first paint.
  const initial = buildPaths(0);

  useEffect(() => {
    if (points.length < 2) return;
    // Rispetta prefers-reduced-motion: niente animazione, una sola
    // resa del path neutro.
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    let raf = 0;
    const start = performance.now();
    const omega = (2 * Math.PI) / (WAVE_PERIOD_S * 1000);

    const tick = (now: number) => {
      const phase = (now - start) * omega;
      const { line, area } = buildPaths(phase);
      if (linePathRef.current) linePathRef.current.setAttribute("d", line);
      if (areaPathRef.current) areaPathRef.current.setAttribute("d", area);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  if (points.length < 2) return null;
  const baseY = PAD.top + INNER_H;

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      <div className="section-label mb-4">{title}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        preserveAspectRatio="none"
        role="img"
        aria-label={title}
      >
        <defs>
          <linearGradient id="pipeline-flow-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-green)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--color-green)" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        <path ref={areaPathRef} d={initial.area} fill="url(#pipeline-flow-grad)" />
        <path
          ref={linePathRef}
          d={initial.line}
          fill="none"
          stroke="var(--color-green)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p) => (
          <g key={p.key}>
            <circle
              cx={p.x}
              cy={p.y}
              r={4}
              fill="var(--color-green)"
              stroke="var(--color-card)"
              strokeWidth={1.5}
            />
            <text
              x={p.x}
              y={p.y - 10}
              textAnchor="middle"
              fontSize={12}
              fontWeight={700}
              fill="var(--color-green)"
              style={{ fontFamily: "inherit" }}
            >
              {p.count}
            </text>
            <text
              x={p.x}
              y={baseY + 22}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-dim)"
              letterSpacing={1.4}
              style={{
                fontFamily: "inherit",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
