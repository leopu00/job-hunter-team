'use client'

// UsageCallsChart — gemello di UsageTokensChart ma su CHIAMATE API.
//
// Il rate limit Kimi Code è basato su CHIAMATE per finestra 5h (300-1200
// totali nel plan). Questo grafico misura il vero rate, non i token. La
// linea predicted dovrebbe combaciare quasi esattamente con l'usage reale,
// e il ratio chiamate/% dovrebbe essere quasi costante (~3 per il plan
// base da 300, fino a ~12 per il plan superiore).
//
// Sorgente: /api/calls/series (cumulativo team chiamate API, bucket dinamico)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Entry = {
  ts: string
  provider: string
  usage: number
  status: string
  reset_at?: string
  source?: string
}

type CallsPoint = { tsMs: number; calls: number }
type PredictedPoint = { tsMs: number; usage: number }
type StepEvent = { ts: number; usage: number; calls: number }
type MacroRatioPoint = { tsMs: number; ratio: number }
type HoverState = { tsMs: number; xPct: number; yPct: number } | null

const RANGES = [
  { id: '10m', label: '10m', minutes: 10 },
  { id: '30m', label: '30m', minutes: 30 },
  { id: '1h',  label: '1h',  minutes: 60 },
  { id: '3h',  label: '3h',  minutes: 180 },
  { id: '6h',  label: '6h',  minutes: 6 * 60 },
  { id: '24h', label: '24h', minutes: 24 * 60 },
] as const
type RangeId = (typeof RANGES)[number]['id']

const GAP_MS = 12 * 60 * 1000

function nearestByTs<T extends { tsMs: number }>(arr: T[], tsMs: number): T | null {
  if (arr.length === 0) return null
  let lo = 0, hi = arr.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].tsMs < tsMs) lo = mid + 1
    else hi = mid
  }
  let best = arr[lo]
  let bestDiff = Math.abs(arr[lo].tsMs - tsMs)
  if (lo > 0) {
    const d = Math.abs(arr[lo - 1].tsMs - tsMs)
    if (d < bestDiff) { best = arr[lo - 1]; bestDiff = d }
  }
  return best
}

function fmtCalls(v: number): string {
  if (v < 1000) return `${v.toFixed(0)}`
  return `${(v / 1000).toFixed(2)}k`
}

function fmtRatioCalls(v: number): string {
  return `${v.toFixed(2)} call/%`
}

function fmtDuration(ms: number): string {
  if (ms < 0) return '—'
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function Tooltip({
  tsMs, entries, predictedSeries, callsSeries, sessionStart,
}: {
  tsMs: number
  entries: Entry[]
  predictedSeries: PredictedPoint[]
  callsSeries: CallsPoint[]
  sessionStart: { usage: number; calls: number } | null
}) {
  const ts = new Date(tsMs)
  let nearestEntry: Entry | null = null
  let nearestDiff = Infinity
  for (const e of entries) {
    const t = Date.parse(e.ts)
    if (!Number.isFinite(t)) continue
    const d = Math.abs(t - tsMs)
    if (d < nearestDiff) { nearestDiff = d; nearestEntry = e }
  }
  const pred = nearestByTs(predictedSeries, tsMs)
  const calls = nearestByTs(callsSeries, tsMs)
  return (
    <div className="pointer-events-none">
      <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
        {ts.toLocaleTimeString()} · {ts.toLocaleDateString()}
      </div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[11px] font-mono">
        {nearestEntry && (
          <>
            <div>
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 10, height: 2, background: '#22d3ee',
                verticalAlign: 'middle', marginRight: 6,
              }} />
              <span className="text-[var(--color-dim)]">usage:</span>
            </div>
            <div className="text-[var(--color-bright)] font-semibold">{nearestEntry.usage}%</div>
          </>
        )}
        {pred && Number.isFinite(pred.usage) && (
          <>
            <div>
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 10, height: 2, background: '#fb923c',
                verticalAlign: 'middle', marginRight: 6,
              }} />
              <span className="text-[var(--color-dim)]">stimato:</span>
            </div>
            <div style={{ color: '#fb923c' }}>{pred.usage.toFixed(2)}%</div>
          </>
        )}
        {calls && (
          <>
            <div>
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 10, height: 2,
                background: 'repeating-linear-gradient(90deg, #4ade80 0 5px, transparent 5px 8px)',
                verticalAlign: 'middle', marginRight: 6,
              }} />
              <span className="text-[var(--color-dim)]">chiamate:</span>
            </div>
            <div style={{ color: '#fde047' }}>{fmtCalls(calls.calls)}</div>
          </>
        )}
        {calls && nearestEntry && sessionStart && (() => {
          const dCalls = calls.calls - sessionStart.calls
          const dU = nearestEntry.usage - sessionStart.usage
          if (dU <= 0 || dCalls <= 0) return null
          const macro = dCalls / dU
          return (
            <>
              <div>
                <span className="text-[var(--color-dim)]" style={{ marginLeft: 16 }}>ratio macro:</span>
              </div>
              <div style={{ color: 'var(--color-muted)' }}>
                {fmtRatioCalls(macro)}
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}

function Chart({
  entries, predictedSeries, callsSeries, stepEvents, macroRatioSeries, tMin, tMax, onHover,
}: {
  entries: Entry[]
  predictedSeries: PredictedPoint[]
  callsSeries: CallsPoint[]
  stepEvents: StepEvent[]
  macroRatioSeries: MacroRatioPoint[]
  tMin: number
  tMax: number
  onHover: (h: HoverState) => void
}) {
  const W = 1200
  const H = 540
  const PAD = { top: 36, right: 96, bottom: 32, left: 56 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const svgRef = useRef<SVGSVGElement | null>(null)

  const tSpan = Math.max(1, tMax - tMin)
  const xAt = useCallback((ts: number) => PAD.left + ((ts - tMin) / tSpan) * innerW, [tMin, tSpan, innerW])

  const { yMin, yMax } = useMemo(() => {
    const vals: number[] = []
    for (const e of entries) {
      const t = Date.parse(e.ts)
      if (!Number.isFinite(t) || t < tMin || t > tMax) continue
      if (typeof e.usage === 'number') vals.push(e.usage)
    }
    for (const p of predictedSeries) {
      if (p.tsMs >= tMin && p.tsMs <= tMax && Number.isFinite(p.usage)) vals.push(p.usage)
    }
    if (vals.length === 0) return { yMin: 0, yMax: 100 }
    const lo = Math.min(...vals), hi = Math.max(...vals)
    const range = Math.max(1, hi - lo)
    const pad = Math.max(0.5, range * 0.15)
    return { yMin: Math.max(0, lo - pad), yMax: hi + pad }
  }, [entries, predictedSeries, tMin, tMax])

  const ySpan = Math.max(0.001, yMax - yMin)
  const yAt = useCallback((v: number) => PAD.top + innerH - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / ySpan) * innerH, [innerH, yMin, yMax, ySpan])

  // Asse Y dx per chiamate cumulative
  const { callsMin, callsMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const p of callsSeries) {
      if (p.tsMs < tMin || p.tsMs > tMax) continue
      if (p.calls < lo) lo = p.calls
      if (p.calls > hi) hi = p.calls
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { callsMin: 0, callsMax: 1 }
    if (hi - lo < 1) return { callsMin: Math.max(0, lo - 0.5), callsMax: hi + 0.5 }
    const pad = (hi - lo) * 0.1
    return { callsMin: Math.max(0, lo - pad), callsMax: hi + pad }
  }, [callsSeries, tMin, tMax])
  const callsSpan = Math.max(0.001, callsMax - callsMin)
  const yCalls = useCallback((c: number) => PAD.top + innerH - ((Math.max(callsMin, Math.min(callsMax, c)) - callsMin) / callsSpan) * innerH, [innerH, callsMin, callsMax, callsSpan])

  const refLines = useMemo(() => {
    const out: number[] = []
    const step = (yMax - yMin) / 4
    for (let i = 0; i <= 4; i++) out.push(yMin + i * step)
    return out
  }, [yMin, yMax])

  // Auto-zoom Y per la linea ratio macro (chiamate/% cumulativo)
  const { ratioMin, ratioMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const p of macroRatioSeries) {
      if (p.tsMs < tMin || p.tsMs > tMax) continue
      if (p.ratio < lo) lo = p.ratio
      if (p.ratio > hi) hi = p.ratio
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ratioMin: 0, ratioMax: 1 }
    if (hi - lo < 0.5) return { ratioMin: Math.max(0, lo - 0.5), ratioMax: hi + 0.5 }
    const pad = (hi - lo) * 0.15
    return { ratioMin: Math.max(0, lo - pad), ratioMax: hi + pad }
  }, [macroRatioSeries, tMin, tMax])
  const ratioSpan = Math.max(0.001, ratioMax - ratioMin)
  const yRatio = useCallback(
    (r: number) => PAD.top + innerH - ((Math.max(ratioMin, Math.min(ratioMax, r)) - ratioMin) / ratioSpan) * innerH,
    [innerH, ratioMin, ratioMax, ratioSpan]
  )

  const pathFor = (vals: { tsMs: number; v: number }[]) => {
    const parts: string[] = []
    let prev: number | null = null
    for (const p of vals) {
      if (p.tsMs < tMin || p.tsMs > tMax || !Number.isFinite(p.v)) { prev = null; continue }
      const cmd = parts.length === 0 || (prev !== null && p.tsMs - prev > GAP_MS) ? 'M' : 'L'
      parts.push(`${cmd} ${xAt(p.tsMs).toFixed(1)} ${p.v.toFixed(1)}`)
      prev = p.tsMs
    }
    return parts.join(' ')
  }

  const usagePath = useMemo(() => {
    const v = entries.map(e => ({ tsMs: Date.parse(e.ts), v: yAt(e.usage) }))
    return pathFor(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, yAt, tMin, tMax])
  const predPath = useMemo(() => {
    const v = predictedSeries.map(p => ({ tsMs: p.tsMs, v: yAt(p.usage) }))
    return pathFor(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predictedSeries, yAt, tMin, tMax])
  const callsPath = useMemo(() => {
    const v = callsSeries.map(p => ({ tsMs: p.tsMs, v: yCalls(p.calls) }))
    return pathFor(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsSeries, yCalls, tMin, tMax])

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const pxX = e.clientX - rect.left
    const vbX = (pxX / rect.width) * W
    const rel = Math.max(0, Math.min(1, (vbX - PAD.left) / innerW))
    const targetTs = tMin + rel * tSpan
    let bestTs = NaN, bestDiff = Infinity
    const consider = (ts: number) => {
      if (!Number.isFinite(ts) || ts < tMin || ts > tMax) return
      const d = Math.abs(ts - targetTs)
      if (d < bestDiff) { bestDiff = d; bestTs = ts }
    }
    for (const en of entries) consider(Date.parse(en.ts))
    for (const p of callsSeries) consider(p.tsMs)
    if (!Number.isFinite(bestTs)) return
    const ne = entries.reduce<Entry | null>((acc, en) => {
      const t = Date.parse(en.ts)
      if (!Number.isFinite(t)) return acc
      if (acc === null) return en
      return Math.abs(t - bestTs) < Math.abs(Date.parse(acc.ts) - bestTs) ? en : acc
    }, null)
    onHover({
      tsMs: bestTs,
      xPct: (xAt(bestTs) / W) * 100,
      yPct: (yAt(ne?.usage ?? yMin) / H) * 100,
    })
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
      style={{
        width: '100%', maxWidth: W,
        border: '1px solid var(--color-border)', borderRadius: 8,
        background: 'var(--color-panel)', display: 'block',
        cursor: 'crosshair', userSelect: 'none',
      }}
    >
      {refLines.map(v => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yAt(v)} y2={yAt(v)}
                stroke="rgba(255,255,255,0.08)" strokeDasharray="2 6" strokeWidth={0.5} />
          <text x={PAD.left - 6} y={yAt(v) + 4} fontSize={10}
                fill="rgba(34,211,238,0.7)" fontFamily="monospace" textAnchor="end">
            {Number.isInteger(v) ? `${v}%` : `${v.toFixed(yMax - yMin >= 1 ? 1 : 2)}%`}
          </text>
        </g>
      ))}

      <path d={usagePath} stroke="#22d3ee" strokeWidth={3.5} fill="none" />
      <path d={predPath} stroke="#fb923c" strokeWidth={3} fill="none" opacity={0.95} />
      <path d={callsPath} stroke="#4ade80" strokeWidth={2.5} fill="none" opacity={0.95} strokeDasharray="5 3" />

      {/* Label asse Y dx (chiamate cumulative) */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const v = callsMin + (callsMax - callsMin) * frac
        return (
          <text key={`c-${frac}`} x={W - PAD.right + 6} y={yCalls(v) + 4}
                fontSize={10} fill="rgba(74,222,128,0.95)" fontFamily="monospace">
            {fmtCalls(v)}
          </text>
        )
      })}

      {/* Linea ratio MACRO cumulativo (chiamate/%) — viola tratteggiata */}
      {macroRatioSeries.length > 0 && (
        <path
          d={(() => {
            const parts: string[] = []
            let prev: number | null = null
            for (const p of macroRatioSeries) {
              if (p.tsMs < tMin || p.tsMs > tMax) { prev = null; continue }
              const isGap = prev !== null && (p.tsMs - prev) > GAP_MS
              const cmd = parts.length === 0 || isGap ? 'M' : 'L'
              parts.push(`${cmd} ${xAt(p.tsMs).toFixed(1)} ${yRatio(p.ratio).toFixed(1)}`)
              prev = p.tsMs
            }
            return parts.join(' ')
          })()}
          stroke="#ec4899" strokeWidth={2.5} fill="none"
          strokeDasharray="2 4" opacity={0.95}
        />
      )}
      {macroRatioSeries.length > 0 && (
        <>
          <text x={PAD.left + 4} y={PAD.top + 12} fontSize={9}
                fill="rgba(236,72,153,0.95)" fontFamily="monospace">
            ratio max: {ratioMax.toFixed(2)} call/%
          </text>
          <text x={PAD.left + 4} y={PAD.top + innerH - 4} fontSize={9}
                fill="rgba(236,72,153,0.95)" fontFamily="monospace">
            ratio min: {ratioMin.toFixed(2)} call/%
          </text>
        </>
      )}

      {/* Step events */}
      {stepEvents.map((s, i) => {
        if (s.ts < tMin || s.ts > tMax) return null
        return (
          <circle key={`s-${i}`} cx={xAt(s.ts)} cy={yAt(s.usage)}
                  r={5} fill="#fb923c" stroke="#0f172a" strokeWidth={1.5}>
            <title>step {i}: usage={s.usage}% · {fmtCalls(s.calls)} chiamate</title>
          </circle>
        )
      })}

      <text x={PAD.left} y={H - 8} fontSize={10} fill="rgba(255,255,255,0.5)">
        {new Date(tMin).toLocaleTimeString()}
      </text>
      <text x={W - PAD.right} y={H - 8} fontSize={10} fill="rgba(255,255,255,0.5)" textAnchor="end">
        {new Date(tMax).toLocaleTimeString()}
      </text>

      {entries.length === 0 && (
        <text x={PAD.left + innerW / 2} y={PAD.top + innerH / 2}
              fontSize={12} fill="rgba(255,255,255,0.45)" textAnchor="middle">
          In attesa dati…
        </text>
      )}
    </svg>
  )
}

export default function UsageCallsChart() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [callsSeries, setCallsSeries] = useState<CallsPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeId>('30m')
  const [hover, setHover] = useState<HoverState>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())

  const loadData = useCallback(async () => {
    try {
      const r = await fetch('/api/sentinella/data', { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) setEntries(j.entries || [])
    } catch { /* */ }
    finally { setLoading(false) }
  }, [])

  const loadCalls = useCallback(async () => {
    const meta = RANGES.find(r => r.id === range) ?? RANGES[1]
    const sinceMin = Number.isFinite(meta.minutes)
      ? Math.max(10, Math.min(24 * 60, Math.round(meta.minutes)))
      : 24 * 60
    const bucketSec = sinceMin > 6 * 60 ? 300 : 60
    try {
      const r = await fetch(`/api/calls/series?sinceMin=${sinceMin}&bucketSec=${bucketSec}`, { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok || !Array.isArray(j.series)) return
      const points: CallsPoint[] = j.series
        .map((row: { ts: string; calls: number }) => ({
          tsMs: Date.parse(row.ts),
          calls: typeof row.calls === 'number' ? row.calls : 0,
        }))
        .filter((p: CallsPoint) => Number.isFinite(p.tsMs))
      setCallsSeries(points)
    } catch { /* */ }
  }, [range])

  useEffect(() => {
    loadData(); loadCalls()
    const a = setInterval(loadData, 10_000)
    const b = setInterval(loadCalls, 30_000)
    const c = setInterval(() => setNowTs(Date.now()), 10_000)
    return () => { clearInterval(a); clearInterval(b); clearInterval(c) }
  }, [loadData, loadCalls])

  const { tMin, tMax } = useMemo(() => {
    const meta = RANGES.find(r => r.id === range) ?? RANGES[1]
    if (!Number.isFinite(meta.minutes)) {
      const firstTs = entries.length > 0 ? Date.parse(entries[0].ts) : nowTs - 10 * 60_000
      return { tMin: Number.isFinite(firstTs) ? firstTs : nowTs - 10 * 60_000, tMax: nowTs }
    }
    return { tMin: nowTs - meta.minutes * 60_000, tMax: nowTs }
  }, [range, nowTs, entries])

  const filtered = useMemo(() => entries.filter(e => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t >= tMin && t <= tMax
  }), [entries, tMin, tMax])

  // Session start: ultimo reset event (drop usage > 30) o primo sample
  const sessionStartIdx = useMemo(() => {
    if (entries.length === 0) return -1
    let s = 0
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i-1]?.usage, curr = entries[i]?.usage
      if (typeof prev === 'number' && typeof curr === 'number' && prev - curr > 30) s = i
    }
    return s
  }, [entries])

  // Step events (Δusage ≥ 1) con conteggio chiamate al ts
  const stepEvents = useMemo<StepEvent[]>(() => {
    if (sessionStartIdx < 0 || callsSeries.length === 0) return []
    const session = entries.slice(sessionStartIdx)
    const out: StepEvent[] = []
    let lastUsage = -Infinity
    const callsAt = (ts: number) => {
      const p = nearestByTs(callsSeries, ts)
      return p?.calls ?? null
    }
    for (const e of session) {
      const ts = Date.parse(e.ts)
      if (!Number.isFinite(ts) || typeof e.usage !== 'number') continue
      const isFirst = out.length === 0
      const isStep = e.usage >= lastUsage + 1
      if (isFirst || isStep) {
        const c = callsAt(ts)
        if (c !== null) {
          out.push({ ts, usage: e.usage, calls: c })
          lastUsage = e.usage
        }
      }
    }
    return out
  }, [entries, sessionStartIdx, callsSeries])

  // Calibrazione MACRO chiamate/%
  const calibration = useMemo(() => {
    if (stepEvents.length < 2) return null
    const first = stepEvents[0], last = stepEvents[stepEvents.length - 1]
    const dC = last.calls - first.calls, dU = last.usage - first.usage
    if (dU <= 0 || dC <= 0) return null
    return { ratio: dC / dU, samples: stepEvents.length }
  }, [stepEvents])

  // Predicted piecewise: ricongiunge agli step, tail con calibration.ratio
  const predictedSeries = useMemo<PredictedPoint[]>(() => {
    if (stepEvents.length === 0 || callsSeries.length === 0) return []
    const out: PredictedPoint[] = []
    let stepIdx = 0
    for (const p of callsSeries) {
      while (stepIdx + 1 < stepEvents.length && stepEvents[stepIdx + 1].ts <= p.tsMs) stepIdx++
      const anchor = stepEvents[stepIdx]
      if (p.tsMs < anchor.ts) continue
      let ratio: number | null = null
      if (stepIdx + 1 < stepEvents.length) {
        const next = stepEvents[stepIdx + 1]
        const dU = next.usage - anchor.usage, dC = next.calls - anchor.calls
        if (dU > 0 && dC > 0) ratio = dC / dU
      } else if (calibration) {
        ratio = calibration.ratio
      }
      if (ratio === null || ratio <= 0) continue
      out.push({ tsMs: p.tsMs, usage: anchor.usage + (p.calls - anchor.calls) / ratio })
    }
    return out
  }, [stepEvents, callsSeries, calibration])

  // Serie ratio MACRO cumulativo (chiamate/% dalla nascita sessione)
  const macroRatioSeries = useMemo<MacroRatioPoint[]>(() => {
    if (stepEvents.length < 2) return []
    const first = stepEvents[0]
    const out: MacroRatioPoint[] = []
    for (let i = 1; i < stepEvents.length; i++) {
      const dC = stepEvents[i].calls - first.calls
      const dU = stepEvents[i].usage - first.usage
      if (dU > 0 && dC > 0) out.push({ tsMs: stepEvents[i].ts, ratio: dC / dU })
    }
    return out
  }, [stepEvents])

  const budgetStats = useMemo(() => {
    if (stepEvents.length === 0 || callsSeries.length === 0) return null
    const sessionStart = stepEvents[0]
    const last = callsSeries[callsSeries.length - 1]
    const consumed = Math.max(0, last.calls - sessionStart.calls)
    if (!calibration) return { consumed, budget: null, remaining: null, sessionStart }
    const budget = (100 - sessionStart.usage) * calibration.ratio
    const remaining = Math.max(0, budget - consumed)
    return { consumed, budget, remaining, sessionStart }
  }, [stepEvents, callsSeries, calibration])

  // ETA
  const { etaTo100Ms, etaResetMs } = useMemo(() => {
    let etaTo100Ms: number | null = null, etaResetMs: number | null = null
    for (let i = entries.length - 1; i >= 0; i--) {
      const r = entries[i].reset_at
      if (!r) continue
      const [h, m] = r.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) break
      const now = new Date()
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0))
      if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1)
      etaResetMs = target.getTime() - now.getTime()
      break
    }
    if (budgetStats?.remaining !== null && budgetStats?.remaining !== undefined && callsSeries.length >= 2) {
      const last = callsSeries[callsSeries.length - 1]
      const cutoff = last.tsMs - 3 * 60 * 1000
      let earliest = callsSeries[0]
      for (const p of callsSeries) {
        if (p.tsMs >= cutoff) { earliest = p; break }
      }
      const dC = last.calls - earliest.calls, dMs = last.tsMs - earliest.tsMs
      if (dC > 0 && dMs > 0) etaTo100Ms = budgetStats.remaining / (dC / dMs)
    }
    return { etaTo100Ms, etaResetMs }
  }, [entries, callsSeries, budgetStats])

  const last = filtered.length > 0 ? filtered[filtered.length - 1] : null
  const hoveredTsMs = hover?.tsMs ?? null

  let verdict: { color: string; label: string } | null = null
  if (etaTo100Ms !== null && etaResetMs !== null && etaResetMs > 0) {
    const m = etaTo100Ms / etaResetMs
    if (m > 1.3) verdict = { color: '#4ade80', label: 'safe' }
    else if (m > 1.05) verdict = { color: '#facc15', label: 'stretto' }
    else verdict = { color: '#f87171', label: 'sfori' }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-dim)]">
            Rate budget + chiamate API team
          </span>
          {last && (
            <span className="text-[11px] text-[var(--color-muted)]">
              {last.provider} · {last.usage}%
            </span>
          )}
          {calibration ? (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(251,146,60,0.10)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.3)' }}
                  title={`Macro chiamate/% su ${calibration.samples} step. Stima limite plan: ${(calibration.ratio * 100).toFixed(0)} chiamate/finestra`}>
              ratio {calibration.ratio.toFixed(2)} call/% · {calibration.samples} step
            </span>
          ) : (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(148,163,184,0.10)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>
              ratio: calibrando…
            </span>
          )}
          {budgetStats && (
            <>
              <div className="flex flex-col px-2 py-1 rounded text-[10px] font-mono leading-tight"
                   style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.25)' }}>
                <span className="text-[var(--color-dim)] uppercase tracking-wide text-[9px]">consumate</span>
                <span style={{ color: '#22d3ee', fontWeight: 600 }}>{fmtCalls(budgetStats.consumed)}</span>
              </div>
              <div className="flex flex-col px-2 py-1 rounded text-[10px] font-mono leading-tight"
                   style={{ background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.25)' }}
                   title={budgetStats.budget !== null && budgetStats.remaining !== null
                     ? `Budget = (100 - ${budgetStats.sessionStart.usage}%) × ${calibration?.ratio.toFixed(2)} = ${fmtCalls(budgetStats.budget)} chiamate.\nRimanenti: ${fmtCalls(budgetStats.remaining)}`
                     : ''}>
                <span className="text-[var(--color-dim)] uppercase tracking-wide text-[9px]">
                  budget {budgetStats.budget !== null ? `· ${((budgetStats.consumed / budgetStats.budget) * 100).toFixed(0)}% usato` : ''}
                </span>
                <span style={{ color: '#4ade80', fontWeight: 600 }}>
                  {budgetStats.budget !== null ? fmtCalls(budgetStats.budget) : '—'}
                </span>
              </div>
              {verdict && etaTo100Ms !== null && (
                <div className="flex flex-col px-2 py-1 rounded text-[10px] font-mono leading-tight"
                     style={{ background: `${verdict.color}10`, border: `1px solid ${verdict.color}50` }}>
                  <span className="text-[var(--color-dim)] uppercase tracking-wide text-[9px]">
                    ETA 100% · {verdict.label}
                  </span>
                  <span style={{ color: verdict.color, fontWeight: 600 }}>{fmtDuration(etaTo100Ms)}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-1" role="radiogroup" aria-label="time range">
          {RANGES.map(r => {
            const active = r.id === range
            return (
              <button key={r.id} type="button" role="radio" aria-checked={active}
                      onClick={() => setRange(r.id)}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold transition-colors"
                      style={{
                        background: active ? 'rgba(34,211,238,0.15)' : 'transparent',
                        color: active ? '#22d3ee' : 'var(--color-dim)',
                        border: `1px solid ${active ? 'rgba(34,211,238,0.4)' : 'var(--color-border)'}`,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                {r.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading && filtered.length === 0 ? (
        <div className="text-[11px] text-[var(--color-dim)] py-6 text-center">Caricamento…</div>
      ) : (
        <>
          <div className="relative">
            <Chart
              entries={filtered}
              predictedSeries={predictedSeries}
              callsSeries={callsSeries}
              stepEvents={stepEvents}
              macroRatioSeries={macroRatioSeries}
              tMin={tMin}
              tMax={tMax}
              onHover={setHover}
            />
            {hover && hoveredTsMs !== null && (
              <>
                <div aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 w-px"
                     style={{ left: `${hover.xPct}%`, background: 'rgba(255,255,255,0.2)' }} />
                <div className="absolute z-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 shadow-lg"
                     style={{
                       left: hover.xPct > 55 ? undefined : `calc(${hover.xPct}% + 12px)`,
                       right: hover.xPct > 55 ? `calc(${100 - hover.xPct}% + 12px)` : undefined,
                       top: hover.yPct > 50 ? '8px' : undefined,
                       bottom: hover.yPct > 50 ? undefined : '8px',
                       minWidth: 220,
                     }}>
                  <Tooltip
                    tsMs={hoveredTsMs}
                    entries={entries}
                    predictedSeries={predictedSeries}
                    callsSeries={callsSeries}
                    sessionStart={budgetStats?.sessionStart ?? null}
                  />
                </div>
              </>
            )}
          </div>
          <div className="px-1 mt-2 text-[10px] text-[var(--color-muted)] flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 2, background: '#22d3ee' }} />
              usage
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 2, background: '#fb923c' }} />
              usage stimato dalle chiamate (piecewise)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 14, height: 2,
                background: 'repeating-linear-gradient(90deg, #4ade80 0 5px, transparent 5px 8px)',
              }} />
              chiamate cumulative (asse dx)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: '#fb923c', border: '1px solid #0f172a',
              }} />
              step (anchor)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 14, height: 2,
                background: 'repeating-linear-gradient(90deg, #ec4899 0 4px, transparent 4px 6px)',
              }} />
              ratio chiamate/% macro cumulativo
            </span>
          </div>
        </>
      )}
    </div>
  )
}
