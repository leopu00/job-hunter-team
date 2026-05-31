"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type HistoryRow = {
  id: string;
  status: string;
  critic_verdict: string | null;
  found_at: string | null;
  last_checked: string | null;
  scored_at: string | null;
  written_at: string | null;
  critic_reviewed_at: string | null;
  applied_at: string | null;
  response_at: string | null;
};

const W = 800;
const H = 260;
const PAD = { top: 30, right: 32, bottom: 48, left: 32 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

const WAVE_AMPLITUDE = 10;
const WAVE_PERIOD_S = 7;

const ORDER: Array<{ key: string; label: string }> = [
  { key: "new", label: "NEW" },
  { key: "checked", label: "ANALYZED" },
  { key: "scored", label: "SCORED" },
  { key: "writing", label: "WRITING" },
  { key: "ready", label: "READY" },
  { key: "applied", label: "SENT" },
];

function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// Stato della pipeline a un istante T per una singola posizione.
// Costruisce la sequenza di eventi temporali con lo stage associato e
// restituisce lo stage dell'evento più recente con timestamp ≤ T.
// "review" è collassato dentro "writing" (transitorio breve).
// stage=null significa esclusa (rimossa dalla pipeline attiva).
function stageAt(row: HistoryRow, T: number): string | null {
  const found = parseTs(row.found_at);
  if (found == null || found > T) return null;

  type Ev = { at: number; stage: string | null };
  const events: Ev[] = [{ at: found, stage: "new" }];

  const checkedAt = parseTs(row.last_checked);
  if (checkedAt != null) {
    // Se l'Analista ha escluso → exclusion at last_checked, ma SOLO se
    // non è andata oltre (no scored/written/critic). Altrimenti
    // last_checked è quando ha passato il filtro.
    const wentBeyond =
      row.scored_at != null ||
      row.written_at != null ||
      row.critic_reviewed_at != null;
    if (row.status === "excluded" && !wentBeyond) {
      events.push({ at: checkedAt, stage: null });
    } else {
      events.push({ at: checkedAt, stage: "checked" });
    }
  }

  const scoredAt = parseTs(row.scored_at);
  if (scoredAt != null) events.push({ at: scoredAt, stage: "scored" });

  const writtenAt = parseTs(row.written_at);
  if (writtenAt != null) events.push({ at: writtenAt, stage: "writing" });

  const reviewAt = parseTs(row.critic_reviewed_at);
  if (reviewAt != null) {
    if (row.critic_verdict === "PASS") {
      events.push({ at: reviewAt, stage: "ready" });
    } else if (row.critic_verdict === "REJECT") {
      events.push({ at: reviewAt, stage: null });
    } else {
      // NEEDS_WORK o altri → torna a writing (iterazione v2/v3)
      events.push({ at: reviewAt, stage: "writing" });
    }
  }

  const appAt = parseTs(row.applied_at);
  if (appAt != null) events.push({ at: appAt, stage: "applied" });

  const respAt = parseTs(row.response_at);
  if (respAt != null) events.push({ at: respAt, stage: "applied" });

  events.sort((a, b) => a.at - b.at);
  let stage: string | null = null;
  for (const e of events) {
    if (e.at > T) break;
    stage = e.stage;
  }
  return stage;
}

function countsAt(history: HistoryRow[], T: number): Record<string, number> {
  const c: Record<string, number> = {
    new: 0,
    checked: 0,
    scored: 0,
    writing: 0,
    ready: 0,
    applied: 0,
  };
  for (const r of history) {
    const s = stageAt(r, T);
    if (s && s in c) c[s]++;
  }
  return c;
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

export default function PipelineFlow({ steps, title }: Props) {
  // Server-rendered initial: usa lo snapshot "now" passato da page.tsx
  // come fallback finché non arriva la history client.
  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of steps) m[s.key] = s.color;
    return m;
  }, [steps]);

  const initialCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of steps) m[s.key] = s.count;
    return m;
  }, [steps]);

  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [time, setTime] = useState<number>(Date.now());
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  // Durata totale del play-through (min→max) in ms.
  const PLAY_DURATION_MS = 16000;

  useEffect(() => {
    let alive = true;
    fetch("/api/positions/state-history")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: HistoryRow[]) => {
        if (!alive) return;
        setHistory(Array.isArray(d) ? d : []);
        setTime(Date.now());
      })
      .catch(() => {
        if (!alive) return;
        setHistory([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Min time: prima posizione trovata. Max: now.
  const [minT, maxT] = useMemo(() => {
    if (!history || history.length === 0) {
      return [Date.now() - 7 * 24 * 3600 * 1000, Date.now()];
    }
    let min = Infinity;
    for (const r of history) {
      const t = parseTs(r.found_at);
      if (t != null && t < min) min = t;
    }
    if (!Number.isFinite(min)) min = Date.now() - 7 * 24 * 3600 * 1000;
    return [min, Date.now()];
  }, [history]);

  const currentCounts = useMemo(() => {
    if (!history) return initialCounts;
    return countsAt(history, time);
  }, [history, time, initialCounts]);

  const stages = ORDER.map((o) => ({
    key: o.key,
    label: o.label,
    count: currentCounts[o.key] ?? 0,
    color: colorMap[o.key] ?? "var(--color-dim)",
  }));

  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  const points = useMemo(
    () =>
      stages.map((s, i) => {
        const x = PAD.left + (INNER_W * i) / Math.max(1, stages.length - 1);
        const y = PAD.top + INNER_H * (1 - s.count / maxCount);
        return { x, y, ...s };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentCounts, maxCount],
  );

  const linePathRef = useRef<SVGPathElement>(null);
  const areaPathRef = useRef<SVGPathElement>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const buildPaths = (phase: number, pts: typeof points) => {
    if (pts.length < 2) return { line: "", area: "" };
    const t = 0.22;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const cp1x = p1.x + (p2.x - p0.x) * t;
      let cp1y = p1.y + (p2.y - p0.y) * t;
      const cp2x = p2.x - (p3.x - p1.x) * t;
      let cp2y = p2.y - (p3.y - p1.y) * t;
      // Phase shift 0.55 per segmento + delta 0.28 fra i due CP →
      // onda viaggiante uniforme, senza zigzag fra i punti dati.
      cp1y += Math.sin(phase + i * 0.55) * WAVE_AMPLITUDE;
      cp2y += Math.sin(phase + i * 0.55 + 0.28) * WAVE_AMPLITUDE;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    const baseY = PAD.top + INNER_H;
    const area = `${d} L ${pts[pts.length - 1].x} ${baseY} L ${pts[0].x} ${baseY} Z`;
    return { line: d, area };
  };

  const initial = buildPaths(0, points);

  useEffect(() => {
    if (points.length < 2) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;

    let raf = 0;
    const start = performance.now();
    const omega = (2 * Math.PI) / (WAVE_PERIOD_S * 1000);
    // Y "eased" per ogni punto: insegue il target ogni frame con
    // smoothing factor → la curva morfa gradualmente quando i count
    // cambiano (no più snap discreto durante il play-through).
    const easedY = pointsRef.current.map((p) => p.y);
    const SMOOTH = 0.08;

    const tick = (now: number) => {
      const phase = (now - start) * omega;
      const target = pointsRef.current;
      // Match length se cambia (improbabile a runtime, ma safe)
      while (easedY.length < target.length) easedY.push(target[easedY.length].y);
      easedY.length = target.length;
      for (let i = 0; i < target.length; i++) {
        easedY[i] += (target[i].y - easedY[i]) * SMOOTH;
      }
      const pts = target.map((p, i) => ({ ...p, y: easedY[i] }));
      const { line, area } = buildPaths(phase, pts);
      if (linePathRef.current) linePathRef.current.setAttribute("d", line);
      if (areaPathRef.current) areaPathRef.current.setAttribute("d", area);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);

  // Time-lapse player: avanza `time` da minT a maxT in PLAY_DURATION_MS.
  // Se time è già al massimo, riparte da minT al click play.
  useEffect(() => {
    if (!isPlaying) return;
    if (maxT <= minT) {
      setIsPlaying(false);
      return;
    }

    const span = maxT - minT;
    const startWall = performance.now();
    const startSim = time >= maxT ? minT : time;
    if (time >= maxT) setTime(minT);

    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startWall;
      const progress = (startSim - minT) / span + elapsed / PLAY_DURATION_MS;
      const newTime = minT + span * progress;
      if (newTime >= maxT) {
        setTime(maxT);
        setIsPlaying(false);
        return;
      }
      setTime(newTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, minT, maxT]);

  if (points.length < 2) return null;
  const baseY = PAD.top + INNER_H;

  const isLive = time >= maxT - 60_000; // ~now
  const totalActive = stages.reduce((a, s) => a + s.count, 0);

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">{title}</span>
        <span className="text-[10px] text-[var(--color-dim)]">
          <span className="text-[var(--color-bright)] font-semibold">
            {totalActive}
          </span>{" "}
          attive
        </span>
      </div>

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
              style={{ transition: "cy 0.45s ease-out" }}
            />
            <text
              x={p.x}
              y={p.y - 10}
              textAnchor="middle"
              fontSize={12}
              fontWeight={700}
              fill="var(--color-green)"
              style={{
                fontFamily: "inherit",
                transition: "y 0.45s ease-out",
              }}
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

      {/* Time-lapse: play/stop + slider scrubabile manuale */}
      {history && history.length > 0 && maxT > minT && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] mb-1.5">
            <span className="text-[var(--color-dim)] tabular-nums">
              {fmtDateTime(minT)}
            </span>
            <span
              className="font-semibold tracking-[0.12em] uppercase"
              style={{
                color: isPlaying
                  ? "var(--color-yellow)"
                  : isLive
                    ? "var(--color-green)"
                    : "var(--color-yellow)",
              }}
            >
              {isPlaying
                ? `▶ ${fmtDateTime(time)}`
                : isLive
                  ? "● live"
                  : `◀ ${fmtDateTime(time)}`}
            </span>
            <span className="text-[var(--color-dim)] tabular-nums">
              {fmtDateTime(maxT)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              aria-label={isPlaying ? "Stop" : "Play"}
              title={isPlaying ? "Stop time-lapse" : "Play time-lapse"}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "1px solid var(--color-border)",
                background: isPlaying
                  ? "var(--color-yellow)"
                  : "var(--color-green)",
                color: "#000",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "inherit",
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.2s ease, transform 0.1s ease",
              }}
            >
              {isPlaying ? "■" : "▶"}
            </button>
            <input
              type="range"
              min={minT}
              max={maxT}
              step={Math.max(60_000, Math.round((maxT - minT) / 500))}
              value={time}
              onChange={(e) => {
                if (isPlaying) setIsPlaying(false);
                setTime(Number(e.target.value));
              }}
              onMouseDown={() => setIsDragging(true)}
              onMouseUp={() => setIsDragging(false)}
              onTouchStart={() => setIsDragging(true)}
              onTouchEnd={() => setIsDragging(false)}
              className="flex-1 pipeline-flow-slider"
              aria-label="Tempo della pipeline"
              style={{
                accentColor: isPlaying
                  ? "var(--color-yellow)"
                  : isLive
                    ? "var(--color-green)"
                    : "var(--color-yellow)",
              }}
            />
          </div>
          {!isLive && !isPlaying && (
            <div className="text-center mt-1">
              <button
                onClick={() => setTime(maxT)}
                className="text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px 8px",
                  fontFamily: "inherit",
                }}
              >
                {isDragging ? "scrubbing…" : "torna a live →"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
