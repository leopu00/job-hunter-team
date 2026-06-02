"use client"

import { useMemo, useRef, useState } from "react"
import type { Window } from "./types"
import { useChartTheme, chartPalette } from "./chart-theme"

type Props = {
  weekly: Window
  accentColor: string
  capPct?: number
}

// Single horizontal chart spanning the full weekly window (all 5h slices fused).
// Renders cumulative usage area + 5h boundaries + reset markers. Width scales
// with run duration so the container scrolls horizontally.
export function FullRunUsageChart({ weekly, accentColor, capPct = 92 }: Props) {
  const { mode } = useChartTheme()
  const P = chartPalette(mode)
  const start = weekly.started_at ? new Date(weekly.started_at).getTime() : null
  const end = weekly.ended_at ? new Date(weekly.ended_at).getTime() : null
  const burnSamples = weekly.burn_samples ?? []
  const fiveHour = weekly.five_hour_windows ?? []

  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ ts: number; x: number; y: number } | null>(null)

  // Pre-sorted timestamps for fast nearest-neighbour lookup
  const samplesByTs = useMemo(() => {
    return burnSamples
      .map((s) => ({
        ts: new Date(s.ts).getTime(),
        weekly: s.weekly_usage_pct ?? 0,
        window: s.window_usage_pct ?? 0,
      }))
      .sort((a, b) => a.ts - b.ts)
  }, [burnSamples])

  if (!start || !end || burnSamples.length === 0) return null

  const totalH = (end - start) / 3_600_000
  // ~140px per hour → 35h ≈ 4900px wide
  const pxPerHour = 140
  const innerW = Math.max(1200, Math.round(totalH * pxPerHour))
  const padL = 50
  const padR = 30
  const padT = 30
  const padB = 32
  const chartH = 220
  const w = innerW + padL + padR
  const h = padT + chartH + padB

  const xOf = (ts: number) =>
    padL + ((Math.max(start, Math.min(end, ts)) - start) / (end - start)) * innerW
  const yOf = (pct: number) => padT + chartH * (1 - pct / 100)

  // Build usage points from burn_samples, splitting at provider resets
  // (window_usage_pct drop > 40pp signals a rolling-window reset).
  type Point = { x: number; y: number; weekly: number }
  const segments: { points: Point[]; isFrozen?: boolean }[] = []
  let cur: Point[] = []
  let lastWindowPct = 0
  const resets: number[] = []
  for (const s of burnSamples) {
    const ts = new Date(s.ts).getTime()
    const wp = s.window_usage_pct ?? 0
    if (cur.length > 0 && lastWindowPct - wp >= 40) {
      segments.push({ points: cur })
      resets.push(xOf(ts))
      cur = []
    }
    cur.push({ x: xOf(ts), y: yOf(wp), weekly: s.weekly_usage_pct ?? 0 })
    lastWindowPct = wp
  }
  if (cur.length > 0) segments.push({ points: cur })

  // Weekly cumulative line (from same samples)
  const weeklyPath = burnSamples
    .map((s, i) => {
      const ts = new Date(s.ts).getTime()
      return `${i === 0 ? "M" : "L"} ${xOf(ts).toFixed(1)} ${yOf(s.weekly_usage_pct ?? 0).toFixed(1)}`
    })
    .join(" ")

  const segPaths = segments.map((seg) => ({
    line: seg.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" "),
    area:
      seg.points.length > 0
        ? `M ${seg.points[0].x.toFixed(1)} ${(padT + chartH).toFixed(1)} ` +
          seg.points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
          ` L ${seg.points[seg.points.length - 1].x.toFixed(1)} ${(padT + chartH).toFixed(1)} Z`
        : "",
  }))

  // 5h window boundaries
  const boundaries = fiveHour.map((fhw) => ({
    start: new Date(fhw.started_at).getTime(),
    end: new Date(fhw.ended_at).getTime(),
    n: fhw.window_number,
  }))

  // X-axis hourly ticks
  const hourTicks: number[] = []
  const startHour = Math.ceil(start / 3_600_000) * 3_600_000
  for (let t = startHour; t <= end; t += 3_600_000) hourTicks.push(t)

  const fmt = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Rome",
  })
  const fmtSec = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Rome",
  })
  const fmtDay = new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Rome",
  })

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * w
    if (px < padL || px > padL + innerW) {
      setHover(null)
      return
    }
    const ts = start + ((px - padL) / innerW) * (end - start)
    setHover({ ts, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const hoverData = useMemo(() => {
    if (!hover || samplesByTs.length === 0) return null
    let nearest = samplesByTs[0]
    let bestDist = Math.abs(nearest.ts - hover.ts)
    for (const s of samplesByTs) {
      const d = Math.abs(s.ts - hover.ts)
      if (d < bestDist) {
        bestDist = d
        nearest = s
      }
    }
    const win = fiveHour.find((f) => {
      const a = new Date(f.started_at).getTime()
      const b = new Date(f.ended_at).getTime()
      return hover.ts >= a && hover.ts <= b
    })
    return { nearest, window: win }
  }, [hover, samplesByTs, fiveHour])

  return (
    <figure
      className="rounded-md border p-2"
      style={{ borderColor: P.figBorder, backgroundColor: P.fullChartFigBg, color: P.figText }}
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-2 pt-1">
        <h6 className="text-sm font-semibold" style={{ color: P.figText }}>
          Usage % — tutto il run ({totalH.toFixed(1)}h · {fiveHour.length} finestre 5h)
        </h6>
        <span className="text-[10px]" style={{ color: P.fullChartCaption }}>
          trascina orizzontalmente per esplorare · linea verde = 5h-cap interno · linea blu = burn weekly cumulativo
        </span>
      </header>
      <div className="relative overflow-x-auto overflow-y-hidden rounded">
        <svg
          ref={svgRef}
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{ display: "block", minWidth: w }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* plot background */}
          <rect x={padL} y={padT} width={innerW} height={chartH} fill={P.fullChartInnerBg} />

          {/* Y grid + labels */}
          {[0, 20, 40, 60, 80, 100].map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={padL + innerW}
                y1={yOf(t)}
                y2={yOf(t)}
                stroke={P.gridLine}
                strokeWidth="0.5"
              />
              <text x={padL - 6} y={yOf(t) + 3} fontSize="9" textAnchor="end" fill={P.topAxisText}>
                {t}%
              </text>
            </g>
          ))}

          {/* 5h-window boundaries (vertical dashed lines) + labels */}
          {boundaries.map((b, i) => (
            <g key={`bnd-${i}`}>
              {i > 0 && (
                <line
                  x1={xOf(b.start)}
                  x2={xOf(b.start)}
                  y1={padT}
                  y2={padT + chartH}
                  stroke={P.minorTick}
                  strokeWidth="0.6"
                  strokeDasharray="3 3"
                />
              )}
              <rect
                x={xOf(b.start) + 4}
                y={padT - 18}
                width={Math.min(40, xOf(b.end) - xOf(b.start) - 8)}
                height="14"
                fill={accentColor}
                fillOpacity="0.85"
                rx="2"
              />
              <text
                x={xOf(b.start) + 10}
                y={padT - 7}
                fontSize="10"
                fontWeight="700"
                fill="white"
              >
                W{b.n}
              </text>
            </g>
          ))}

          {/* Cap line */}
          <line
            x1={padL}
            x2={padL + innerW}
            y1={yOf(capPct)}
            y2={yOf(capPct)}
            stroke={P.capStroke}
            strokeWidth="1"
          />
          <text x={padL + 6} y={yOf(capPct) - 3} fontSize="9" fill={P.capText}>
            {capPct}% cap (5h)
          </text>

          {/* Reset markers */}
          {resets.map((rx, i) => (
            <line
              key={`rst-${i}`}
              x1={rx}
              x2={rx}
              y1={padT}
              y2={padT + chartH}
              stroke={P.resetMarker}
              strokeWidth="0.6"
              strokeDasharray="2 2"
            />
          ))}

          {/* 5h usage segments (area + line) */}
          {segPaths.map((sp, i) => (
            <g key={`seg-${i}`}>
              <path d={sp.area} fill={accentColor} fillOpacity={mode === "dark" ? 0.25 : 0.18} />
              <path d={sp.line} fill="none" stroke={accentColor} strokeWidth="1.4" />
            </g>
          ))}

          {/* Weekly cumulative line on top */}
          <path d={weeklyPath} fill="none" stroke={P.weeklyStroke} strokeWidth="1.3" strokeDasharray="4 2" />

          {/* X-axis hourly labels */}
          {hourTicks.map((t, i) => (
            <g key={`xt-${i}`}>
              <line
                x1={xOf(t)}
                x2={xOf(t)}
                y1={padT + chartH}
                y2={padT + chartH + 4}
                stroke={P.minorTick}
                strokeWidth="0.4"
              />
              <text
                x={xOf(t)}
                y={padT + chartH + 14}
                fontSize="9"
                textAnchor="middle"
                fill={P.topAxisText}
              >
                {fmt.format(new Date(t))}
              </text>
            </g>
          ))}

          {/* Hover guide line */}
          {hover && hoverData && (
            <g pointerEvents="none">
              <line
                x1={xOf(hover.ts)}
                x2={xOf(hover.ts)}
                y1={padT}
                y2={padT + chartH}
                stroke={P.hoverGuide}
                strokeWidth="0.6"
                strokeDasharray="2 2"
              />
              <circle
                cx={xOf(hoverData.nearest.ts)}
                cy={yOf(hoverData.nearest.window)}
                r="3.5"
                fill={accentColor}
                stroke={P.hoverDot}
                strokeWidth="1.2"
              />
              <circle
                cx={xOf(hoverData.nearest.ts)}
                cy={yOf(hoverData.nearest.weekly)}
                r="3"
                fill={P.weeklyStroke}
                stroke={P.hoverDot}
                strokeWidth="1"
              />
            </g>
          )}
        </svg>

        {hover && hoverData && (
          <div
            className="pointer-events-none absolute z-30 min-w-[200px] rounded-md border px-3 py-2 text-[11px] shadow-xl"
            style={{
              left: `${hover.x + 14}px`,
              top: `${hover.y + 14}px`,
              transform: hover.x > w - 250 ? "translateX(-105%)" : undefined,
              backgroundColor: P.hoverTooltipBg,
              borderColor: P.hoverTooltipBorder,
              color: P.hoverTooltipText,
            }}
          >
            <div className="mb-1 font-mono font-semibold" style={{ color: P.hoverTooltipText }}>
              {fmtSec.format(new Date(hover.ts))} · {fmtDay.format(new Date(hover.ts))}
            </div>
            {hoverData.window && (
              <div
                className="mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                style={{ color: P.hoverTooltipMuted, backgroundColor: P.hoverTooltipBadgeBg }}
              >
                Finestra W{hoverData.window.window_number} ({fmt.format(new Date(hoverData.window.started_at))}–
                {fmt.format(new Date(hoverData.window.ended_at))})
              </div>
            )}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
              <dt style={{ color: P.hoverTooltipMuted }}>5h usage</dt>
              <dd className="text-right font-semibold" style={{ color: accentColor }}>
                {Math.round(hoverData.nearest.window)}%
              </dd>
              <dt style={{ color: P.hoverTooltipMuted }}>weekly</dt>
              <dd className="text-right" style={{ color: P.weeklyStroke }}>{Math.round(hoverData.nearest.weekly)}%</dd>
              <dt style={{ color: P.hoverTooltipMuted }}>cap</dt>
              <dd className="text-right" style={{ color: P.capStroke }}>{capPct}%</dd>
            </dl>
          </div>
        )}
      </div>
    </figure>
  )
}
