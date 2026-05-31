"use client"

import { useMemo, useRef, useState } from "react"
import type { FiveHourWindow, BurnSample, AgentActivity } from "./types"

type Props = {
  fiveHourWindow: FiveHourWindow
  samples: BurnSample[] // already filtered to this 5h window, sorted by ts
  activity: AgentActivity[] // already filtered to this 5h window
  accentColor: string
  capPct?: number // rate-limit target line; default 92
}

const AGENT_PALETTE: Record<string, string> = {
  "analista-1": "#facc15",
  "analista-2": "#fbbf24",
  "scout-1": "#f97316",
  "scout-2": "#fb923c",
  "scorer-1": "#22c55e",
  "scorer-2": "#16a34a",
  "scrittore-1": "#3b82f6",
  "scrittore-2": "#60a5fa",
  "scrittore-3": "#93c5fd",
  "critico-s1": "#a78bfa",
  "critico-s2": "#c4b5fd",
  "critico-s3": "#ddd6fe",
  capitano: "#ef4444",
  mentor: "#ec4899",
  assistente: "#06b6d4",
  sentinella: "#14b8a6",
  dottore: "#0ea5e9",
}

const ROLE_EMOJI: Record<string, string> = {
  analista: "👨‍🔬",
  scout: "🕵️",
  scorer: "👨‍💻",
  scrittore: "👨‍🏫",
  critico: "👨‍⚖️",
  capitano: "👨‍✈️",
  sentinella: "💂",
  assistente: "👨‍💼",
  mentor: "🧙",
  dottore: "👨‍⚕️",
}

function baseRole(agent: string): string {
  // Map "scrittore-1" → "scrittore", "critico-s3" → "critico", etc.
  return agent.replace(/-(?:s)?\d+$/, "")
}

function agentSuffix(agent: string): number {
  const m = agent.match(/-(?:s)?(\d+)$/)
  return m ? Number(m[1]) : 0
}

function emojiFor(agent: string): string {
  return ROLE_EMOJI[baseRole(agent)] ?? "🤖"
}

// Vertical order of agent tracks: capitano on top (orchestrator), then the
// pipeline (sentinella → scout → analista → scorer → scrittore → critico),
// dottore last. Any other role gets ROLE_ORDER.length (sinks just above the
// hidden list).
const ROLE_ORDER = [
  "capitano",
  "sentinella",
  "scout",
  "analista",
  "scorer",
  "scrittore",
  "critico",
  "dottore",
]

const HIDDEN_AGENTS = new Set(["assistente"])

function compareAgents(a: string, b: string): number {
  const ra = ROLE_ORDER.indexOf(baseRole(a))
  const rb = ROLE_ORDER.indexOf(baseRole(b))
  const ia = ra < 0 ? ROLE_ORDER.length : ra
  const ib = rb < 0 ? ROLE_ORDER.length : rb
  if (ia !== ib) return ia - ib
  return agentSuffix(a) - agentSuffix(b)
}

type AnchoredPoint = { ts: number; v: number; weekly: number | null }

export function FiveHourWindowChart({
  fiveHourWindow: fhw,
  samples,
  activity,
  accentColor,
  capPct = 92,
}: Props) {
  const start = new Date(fhw.started_at).getTime()
  const end = new Date(fhw.ended_at).getTime()

  // Aggregate agents present in this window
  const agents = useMemo(
    () =>
      Array.from(new Set(activity.map((a) => a.agent)))
        .filter((a) => !HIDDEN_AGENTS.has(baseRole(a)))
        .sort(compareAgents),
    [activity],
  )

  const w = 760
  const padL = 110
  const padR = 70
  const padT = 38
  const padB = 36
  const chartH = 160
  const trackH = 10
  const trackGap = 2
  const activityH = agents.length > 0 ? agents.length * (trackH + trackGap) + 14 : 0
  const h = padT + chartH + activityH + padB
  const innerW = w - padL - padR

  const xOf = (ts: number) =>
    padL + ((Math.max(start, Math.min(end, ts)) - start) / Math.max(1, end - start)) * innerW
  const yOf = (pct: number) => padT + chartH * (1 - pct / 100)

  // Anchored points (filter null window_usage_pct)
  const points: AnchoredPoint[] = useMemo(
    () =>
      samples
        .filter((s) => s.window_usage_pct != null)
        .map((s) => ({
          ts: new Date(s.ts).getTime(),
          v: s.window_usage_pct as number,
          weekly: s.weekly_usage_pct ?? null,
        })),
    [samples],
  )

  // Detect resets (drops ≥40pp), split into render segments
  const { segments, resets } = useMemo(() => {
    const segs: { d: string; area: string }[] = []
    const rs: number[] = []
    let cur: AnchoredPoint[] = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      if (cur.length > 0 && cur[cur.length - 1].v - p.v >= 40) {
        segs.push(buildSegmentPath(cur, xOf, yOf, padT + chartH))
        rs.push(xOf(p.ts))
        cur = []
      }
      cur.push(p)
    }
    if (cur.length > 0) segs.push(buildSegmentPath(cur, xOf, yOf, padT + chartH))
    return { segments: segs, resets: rs }
  }, [points, start, end])

  // Linear trend (over all points)
  const trend = useMemo(() => linearTrend(points), [points])

  // Hover state
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{
    ts: number
    x: number
    y: number
  } | null>(null)

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * w // viewBox-x
    if (px < padL || px > w - padR) {
      setHover(null)
      return
    }
    const ts = start + ((px - padL) / innerW) * (end - start)
    setHover({ ts, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  // Find nearest sample + active agents at hover ts
  const hoverData = useMemo(() => {
    if (!hover || points.length === 0) return null
    const ts = hover.ts
    let nearest = points[0]
    let bestDist = Math.abs(nearest.ts - ts)
    for (const p of points) {
      const d = Math.abs(p.ts - ts)
      if (d < bestDist) {
        bestDist = d
        nearest = p
      }
    }
    const activeAgents = agents.filter((agent) =>
      activity.some(
        (a) => a.agent === agent && new Date(a.ts_start).getTime() <= ts && new Date(a.ts_end).getTime() >= ts,
      ),
    )
    const trendVal = clip(trend(ts), 0, 100)
    return { nearest, activeAgents, trendVal }
  }, [hover, points, agents, activity, trend])

  const trendStart = { x: xOf(start), y: yOf(clip(trend(start), 0, 100)) }
  const trendEnd = { x: xOf(end), y: yOf(clip(trend(end), 0, 100)) }

  const hours = (end - start) / 3600_000
  const tickCount = Math.min(6, Math.max(3, Math.round(hours)))
  const ticks = Array.from(
    { length: tickCount + 1 },
    (_, i) => start + ((end - start) * i) / tickCount,
  )

  const lastPct = points.length > 0 ? points[points.length - 1].v : null
  const firstPct = points.length > 0 ? points[0].v : null
  // The "real" closing value for a 5h window is the max reached BEFORE the
  // provider's rolling reset (after a reset, samples drop near 0 even if the
  // window is still running). We surface that explicitly.
  const peakPoint = useMemo(() => {
    if (points.length === 0) return null
    let best = points[0]
    for (const p of points) if (p.v > best.v) best = p
    return best
  }, [points])

  return (
    <figure className="relative rounded-md border border-slate-300 bg-slate-900 p-2 text-slate-100">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="block w-full"
        role="img"
        aria-label={`5h window ${fhw.window_number} chart`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <text
          x={w / 2}
          y={16}
          fontSize="13"
          fontWeight="700"
          textAnchor="middle"
          fill="#e2e8f0"
        >
          Usage % + Trend — Finestra {fhw.window_number}: {fmtClock(start)} → {fmtClock(end)} UTC ({fmtDay(start)})
        </text>

        <rect x={padL} y={padT} width={innerW} height={chartH} fill="#0f172a" />

        {[0, 20, 40, 60, 80, 100].map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={w - padR}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke="#1e293b"
              strokeWidth="0.5"
            />
            <text
              x={padL - 6}
              y={yOf(t) + 3}
              fontSize="9"
              textAnchor="end"
              fill="#94a3b8"
            >
              {t}%
            </text>
          </g>
        ))}

        <line
          x1={padL}
          x2={w - padR}
          y1={yOf(capPct)}
          y2={yOf(capPct)}
          stroke="#ef4444"
          strokeWidth="1"
        />
        <text x={w - padR + 4} y={yOf(capPct) + 3} fontSize="9" textAnchor="start" fill="#fca5a5">
          {capPct}% cap
        </text>

        {resets.map((rx, i) => (
          <g key={`reset-${i}`}>
            <line
              x1={rx}
              x2={rx}
              y1={padT}
              y2={padT + chartH}
              stroke="#facc15"
              strokeWidth="0.5"
              strokeDasharray="2 2"
            />
            <text
              x={rx + 2}
              y={padT + chartH - 4}
              fontSize="6"
              fill="#facc15"
              opacity="0.8"
            >
              RESET
            </text>
          </g>
        ))}

        {segments.map((s, i) => (
          <g key={`seg-${i}`}>
            <path d={s.area} fill={accentColor} fillOpacity="0.3" />
            <path d={s.d} fill="none" stroke={accentColor} strokeWidth="1.4" />
          </g>
        ))}

        {points.length >= 2 && (
          <line
            x1={trendStart.x}
            x2={trendEnd.x}
            y1={trendStart.y}
            y2={trendEnd.y}
            stroke="#facc15"
            strokeWidth="1"
            strokeDasharray="4 2"
          />
        )}

        {firstPct != null && (
          <text x={xOf(start) + 2} y={yOf(firstPct) - 3} fontSize="8" fill="#e2e8f0">
            {Math.round(firstPct)}%
          </text>
        )}

        {/* Peak marker — the highest window-usage reached inside this 5h window.
            This is the meaningful "closing" value for the rolling 5h cap. */}
        {peakPoint != null && (
          <g pointerEvents="none">
            <circle cx={xOf(peakPoint.ts)} cy={yOf(peakPoint.v)} r="3" fill="#fde68a" stroke="#fbbf24" strokeWidth="0.8" />
            <text
              x={xOf(peakPoint.ts) + (xOf(peakPoint.ts) > w - padR - 80 ? -6 : 6)}
              y={yOf(peakPoint.v) - 5}
              fontSize="11"
              textAnchor={xOf(peakPoint.ts) > w - padR - 80 ? "end" : "start"}
              fill="#fde68a"
              fontWeight="700"
            >
              peak {Math.round(peakPoint.v)}%
            </text>
          </g>
        )}

        {/* Last sample, parked in the right-side padding under the cap label
            so it never collides with the peak marker or the legend. */}
        {lastPct != null && peakPoint != null && lastPct !== peakPoint.v && (
          <text
            x={w - padR + 4}
            y={yOf(capPct) + 16}
            fontSize="8"
            textAnchor="start"
            fill="#94a3b8"
          >
            end {Math.round(lastPct)}%
          </text>
        )}

        {ticks.map((tk, i) => (
          <g key={`xt-${i}`}>
            <line
              x1={xOf(tk)}
              x2={xOf(tk)}
              y1={padT + chartH}
              y2={padT + chartH + 3}
              stroke="#475569"
              strokeWidth="0.5"
            />
            <text
              x={xOf(tk)}
              y={padT + chartH + 11}
              fontSize="7"
              textAnchor="middle"
              fill="#94a3b8"
            >
              {fmtClock(tk)}
            </text>
          </g>
        ))}

        {/* Legend moved to the bottom-left strip below the chart to free up
            top-right space where the peak label lives. */}
        <g transform={`translate(${padL + 4}, ${padT + chartH - 6})`}>
          <rect x="0" y="-3" width="10" height="3" fill={accentColor} fillOpacity="0.6" />
          <text x="13" y="0" fontSize="8" fill="#94a3b8">
            Usage
          </text>
          <line
            x1="48"
            y1="-1"
            x2="58"
            y2="-1"
            stroke="#facc15"
            strokeWidth="1"
            strokeDasharray="3 2"
          />
          <text x="61" y="0" fontSize="8" fill="#94a3b8">
            Trend
          </text>
        </g>

        {agents.length > 0 && (
          <g transform={`translate(0, ${padT + chartH + 10})`}>
            {agents.map((agent, i) => {
              const y = i * (trackH + trackGap)
              const color = AGENT_PALETTE[agent] ?? "#64748b"
              const ivs = activity.filter((a) => a.agent === agent)
              const merged = mergeNearby(ivs, 90_000) // merge ticks within 90s
              return (
                <g key={agent}>
                  <rect
                    x={padL}
                    y={y}
                    width={innerW}
                    height={trackH}
                    fill="#1e293b"
                    fillOpacity="0.4"
                  />
                  {merged.map((m, k) => {
                    const x1 = xOf(m.start)
                    const x2 = Math.max(x1 + 3, xOf(m.end)) // min 3px
                    // Cluster opacity grows with event count (more events → more opaque)
                    const opacity = Math.min(1, 0.55 + m.count * 0.06)
                    return (
                      <rect
                        key={k}
                        x={x1}
                        y={y}
                        width={x2 - x1}
                        height={trackH}
                        fill={color}
                        fillOpacity={opacity}
                      />
                    )
                  })}
                  <text
                    x={padL - 6}
                    y={y + trackH - 2}
                    fontSize="9"
                    textAnchor="end"
                    fill="#cbd5e1"
                  >
                    {emojiFor(agent)} {agent}{" "}
                    <tspan fill="#64748b">· {ivs.length}</tspan>
                  </text>
                </g>
              )
            })}
          </g>
        )}

        {/* Hover guide line */}
        {hover && (
          <line
            x1={xOf(hover.ts)}
            x2={xOf(hover.ts)}
            y1={padT}
            y2={padT + chartH + activityH}
            stroke="#e2e8f0"
            strokeWidth="0.5"
            strokeDasharray="2 2"
            pointerEvents="none"
          />
        )}

        <text
          x={w / 2}
          y={h - 8}
          fontSize="10"
          textAnchor="middle"
          fill="#94a3b8"
        >
          Samples: {points.length} · Activity intervals: {activity.length} · Window W{fhw.window_number}
        </text>
      </svg>

      {hover && hoverData && (
        <Tooltip
          x={hover.x}
          y={hover.y}
          ts={hover.ts}
          windowPct={hoverData.nearest.v}
          weeklyPct={hoverData.nearest.weekly}
          trendPct={hoverData.trendVal}
          activeAgents={hoverData.activeAgents}
        />
      )}
    </figure>
  )
}

function Tooltip({
  x,
  y,
  ts,
  windowPct,
  weeklyPct,
  trendPct,
  activeAgents,
}: {
  x: number
  y: number
  ts: number
  windowPct: number
  weeklyPct: number | null
  trendPct: number
  activeAgents: string[]
}) {
  // Pin tooltip to a corner if cursor is near right edge
  const style: React.CSSProperties = {
    left: `${x + 14}px`,
    top: `${y + 14}px`,
    transform: x > 600 ? "translateX(-105%)" : undefined,
  }
  return (
    <div
      className="pointer-events-none absolute z-30 min-w-[180px] rounded-md border border-slate-600 bg-slate-950/95 px-3 py-2 text-[11px] text-slate-100 shadow-xl"
      style={style}
    >
      <div className="mb-1 font-mono font-semibold text-slate-200">{fmtFullClock(ts)} UTC</div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
        <dt className="text-slate-400">5h usage</dt>
        <dd className="text-right font-semibold text-emerald-300">{Math.round(windowPct)}%</dd>
        {weeklyPct != null && (
          <>
            <dt className="text-slate-400">weekly</dt>
            <dd className="text-right text-slate-100">{Math.round(weeklyPct)}%</dd>
          </>
        )}
        <dt className="text-slate-400">trend</dt>
        <dd className="text-right text-amber-300">{Math.round(trendPct)}%</dd>
      </dl>
      <div className="mt-2 border-t border-slate-700 pt-1">
        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-500">
          attivi ({activeAgents.length})
        </div>
        {activeAgents.length === 0 ? (
          <div className="italic text-slate-500">— nessun agente</div>
        ) : (
          <ul className="space-y-0.5">
            {activeAgents.map((a) => (
              <li key={a} className="flex items-center gap-1.5">
                <span>{emojiFor(a)}</span>
                <span className="font-mono text-slate-200">{a}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

type XF = (ts: number) => number
type YF = (pct: number) => number

function buildSegmentPath(
  pts: AnchoredPoint[],
  xOf: XF,
  yOf: YF,
  baseY: number,
): { d: string; area: string } {
  const xs = pts.map((p) => xOf(p.ts))
  const ys = pts.map((p) => yOf(p.v))
  const d = pts.map((_, i) => `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`).join(" ")
  const area = `${d} L ${xs[xs.length - 1].toFixed(1)} ${baseY} L ${xs[0].toFixed(1)} ${baseY} Z`
  return { d, area }
}

function linearTrend(pts: AnchoredPoint[]): (ts: number) => number {
  if (pts.length < 2) return () => (pts[0]?.v ?? 0)
  const n = pts.length
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (const p of pts) {
    sumX += p.ts
    sumY += p.v
    sumXY += p.ts * p.v
    sumXX += p.ts * p.ts
  }
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return () => sumY / n
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return (ts: number) => slope * ts + intercept
}

function clip(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function fmtClock(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function fmtFullClock(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function fmtDay(ts: number): string {
  const d = new Date(ts)
  const months = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`
}

function pad(n: number): string {
  return n.toString().padStart(2, "0")
}

// Merge intervals whose gap is below `gapMs` into a single cluster, preserving
// total event count so the renderer can scale opacity by density.
function mergeNearby(
  ivs: { ts_start: string; ts_end: string }[],
  gapMs: number,
): { start: number; end: number; count: number }[] {
  if (ivs.length === 0) return []
  const sorted = ivs
    .map((i) => ({ s: new Date(i.ts_start).getTime(), e: new Date(i.ts_end).getTime() }))
    .sort((a, b) => a.s - b.s)
  const out: { start: number; end: number; count: number }[] = [
    { start: sorted[0].s, end: sorted[0].e, count: 1 },
  ]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const last = out[out.length - 1]
    if (cur.s - last.end <= gapMs) {
      last.end = Math.max(last.end, cur.e)
      last.count += 1
    } else {
      out.push({ start: cur.s, end: cur.e, count: 1 })
    }
  }
  return out
}
