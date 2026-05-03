'use client'

// Ratio macro cumulativo kT/% — chart standalone.
// Estratto dal UsageTokensChart per non sovraccaricare il chart usage,
// e perche' il ratio merita un asse Y dedicato (auto-zoom) per leggerne
// l'andamento. Stesso fetch (sentinella + by-type), stesso calcolo
// continuo (un punto per ogni bucket di tokenSeries).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Entry = { ts: string; usage: number }
type TypeBucket = { tsMs: number; in: number; out: number; cr: number; cc: number }
type StepEvent = { ts: number; usage: number; kt: number }
type RatioPoint = { tsMs: number; ratio: number }

type RangeId = '10m' | '30m' | '1h' | '3h' | '6h' | '24h' | 'tutto'
const RANGES: { id: RangeId; label: string; minutes: number }[] = [
  { id: '10m', label: '10m', minutes: 10 },
  { id: '30m', label: '30m', minutes: 30 },
  { id: '1h', label: '1h', minutes: 60 },
  { id: '3h', label: '3h', minutes: 180 },
  { id: '6h', label: '6h', minutes: 360 },
  { id: '24h', label: '24h', minutes: 24 * 60 },
  { id: 'tutto', label: 'tutto', minutes: Infinity },
]

const W = 1000
const H = 360
const PAD = { top: 24, right: 70, bottom: 28, left: 60 }
const innerW = W - PAD.left - PAD.right
const innerH = H - PAD.top - PAD.bottom

// Pesi uniformi per il rate Kimi K2 (cfr. token-by-agent-series.py).
function weightedKt(b: TypeBucket): number {
  return b.in + b.out + b.cr + b.cc
}

export default function RatioMacroChart() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [typeBuckets, setTypeBuckets] = useState<TypeBucket[]>([])
  const [range, setRange] = useState<RangeId>('3h')
  const [nowTs, setNowTs] = useState(() => Date.now())

  const loadData = useCallback(async () => {
    try {
      const r = await fetch('/api/sentinella/data', { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) setEntries(j.entries || [])
    } catch { /* best-effort */ }
  }, [])

  // NB: il fetch dei token e' SEMPRE largo come la sessione (>=6h, copre
  // il rolling Kimi K2 di 5h con margine), indipendentemente dal range
  // selezionato per l'asse X. Motivo: la macroRatio si calcola dalla
  // nascita sessione, quindi servono i kt dalla nascita anche se l'utente
  // sta zoomando solo l'ultima ora. Il range UI controlla solo il viewport,
  // non la finestra dei dati. Bucket fissi a 60s per non degradare la
  // risoluzione nei range corti.
  const loadTokens = useCallback(async () => {
    const meta = RANGES.find(r => r.id === range) ?? RANGES[3]
    const wantedMin = Number.isFinite(meta.minutes) ? Math.round(meta.minutes) : 24 * 60
    const sinceMin = Math.max(360, Math.min(24 * 60, wantedMin))
    const bucketSec = sinceMin > 6 * 60 ? 300 : 60
    try {
      const r = await fetch(
        `/api/tokens/by-type?sinceMin=${sinceMin}&bucketSec=${bucketSec}`,
        { cache: 'no-store' },
      )
      const j = await r.json()
      if (!j.ok || !Array.isArray(j.series)) return
      const buckets: TypeBucket[] = []
      for (const row of j.series as Array<Record<string, unknown>>) {
        const tsMs = typeof row.ts === 'string' ? Date.parse(row.ts) : NaN
        if (!Number.isFinite(tsMs)) continue
        buckets.push({
          tsMs,
          in: typeof row.input_kt === 'number' ? row.input_kt : 0,
          out: typeof row.output_kt === 'number' ? row.output_kt : 0,
          cr: typeof row.cache_read_kt === 'number' ? row.cache_read_kt : 0,
          cc: typeof row.cache_creation_kt === 'number' ? row.cache_creation_kt : 0,
        })
      }
      setTypeBuckets(buckets)
    } catch { /* best-effort */ }
  }, [range])

  useEffect(() => {
    loadData()
    loadTokens()
    const dataId = setInterval(loadData, 10_000)
    const tokenId = setInterval(loadTokens, 30_000)
    const clockId = setInterval(() => setNowTs(Date.now()), 10_000)
    return () => { clearInterval(dataId); clearInterval(tokenId); clearInterval(clockId) }
  }, [loadData, loadTokens])

  // Range temporale.
  const { tMin, tMax } = useMemo(() => {
    const meta = RANGES.find(r => r.id === range) ?? RANGES[3]
    if (!Number.isFinite(meta.minutes)) {
      const first = entries.length > 0 ? Date.parse(entries[0].ts) : nowTs - 60_000
      return { tMin: first, tMax: nowTs }
    }
    return { tMin: nowTs - meta.minutes * 60_000, tMax: nowTs }
  }, [range, nowTs, entries])

  // Step events (Δusage>=1) come anchor della sessione, mappati al bucket
  // token piu' vicino — stessa logica del UsageTokensChart.
  const sessionStartIdx = useMemo(() => {
    if (entries.length === 0) return -1
    let last = 0
    for (let i = 1; i < entries.length; i++) {
      if (Date.parse(entries[i].ts) - Date.parse(entries[i - 1].ts) > 30 * 60_000) last = i
    }
    return last
  }, [entries])

  const nearestTypeBucket = useCallback((tsMs: number) => {
    if (typeBuckets.length === 0) return null
    let lo = 0, hi = typeBuckets.length - 1
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (typeBuckets[m].tsMs < tsMs) lo = m + 1
      else hi = m
    }
    const a = typeBuckets[Math.max(0, lo - 1)]
    const b = typeBuckets[lo]
    return Math.abs(a.tsMs - tsMs) <= Math.abs(b.tsMs - tsMs) ? a : b
  }, [typeBuckets])

  const stepEvents = useMemo<StepEvent[]>(() => {
    if (sessionStartIdx < 0 || typeBuckets.length === 0) return []
    const session = entries.slice(sessionStartIdx)
    const out: StepEvent[] = []
    let lastUsage = -Infinity
    for (const e of session) {
      const ts = Date.parse(e.ts)
      if (!Number.isFinite(ts) || typeof e.usage !== 'number') continue
      if (out.length === 0 || e.usage >= lastUsage + 1) {
        const b = nearestTypeBucket(ts)
        if (b !== null) {
          out.push({ ts, usage: e.usage, kt: weightedKt(b) })
          lastUsage = e.usage
        }
      }
    }
    return out
  }, [entries, sessionStartIdx, typeBuckets, nearestTypeBucket])

  const tokenSeries = useMemo(
    () => typeBuckets.map(b => ({ tsMs: b.tsMs, kt: weightedKt(b) })),
    [typeBuckets],
  )

  const macroRatioSeries = useMemo<RatioPoint[]>(() => {
    if (stepEvents.length < 2 || tokenSeries.length === 0) return []
    const first = stepEvents[0]
    const out: RatioPoint[] = []
    let stepIdx = 0
    for (const tok of tokenSeries) {
      if (tok.tsMs < first.ts) continue
      while (stepIdx + 1 < stepEvents.length && stepEvents[stepIdx + 1].ts <= tok.tsMs) {
        stepIdx++
      }
      const usageNow = stepEvents[stepIdx].usage
      const dKt = tok.kt - first.kt
      const dU = usageNow - first.usage
      if (dU > 0 && dKt > 0) out.push({ tsMs: tok.tsMs, ratio: dKt / dU })
    }
    return out
  }, [stepEvents, tokenSeries])

  // Auto-zoom Y nel range visibile.
  const { rMin, rMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const p of macroRatioSeries) {
      if (p.tsMs < tMin || p.tsMs > tMax) continue
      if (p.ratio < lo) lo = p.ratio
      if (p.ratio > hi) hi = p.ratio
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { rMin: 0, rMax: 1 }
    if (hi - lo < 1) return { rMin: Math.max(0, lo - 0.5), rMax: hi + 0.5 }
    const pad = (hi - lo) * 0.15
    return { rMin: Math.max(0, lo - pad), rMax: hi + pad }
  }, [macroRatioSeries, tMin, tMax])

  const xAt = useCallback(
    (ts: number) => PAD.left + ((ts - tMin) / Math.max(1, tMax - tMin)) * innerW,
    [tMin, tMax],
  )
  const yRatio = useCallback(
    (r: number) => PAD.top + innerH - ((Math.max(rMin, Math.min(rMax, r)) - rMin) / Math.max(0.001, rMax - rMin)) * innerH,
    [rMin, rMax],
  )

  const fmtRatio = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(2)} MT/%` : `${v.toFixed(1)} kT/%`
  const lastPoint = macroRatioSeries.length > 0 ? macroRatioSeries[macroRatioSeries.length - 1] : null

  // Hover: traccia il cursor sull'SVG, mostra linea verticale + tooltip
  // col valore della ratio nel punto piu' vicino. Lavora in coordinate
  // dell'SVG (W/H), non del DOM, cosi' restano consistenti col viewBox.
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hover, setHover] = useState<{ tsMs: number; ratio: number; xPct: number } | null>(null)
  const onMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || macroRatioSeries.length === 0) { setHover(null); return }
    const rect = svg.getBoundingClientRect()
    const xRel = (e.clientX - rect.left) / rect.width  // 0..1 nel viewBox
    const xSvg = xRel * W
    if (xSvg < PAD.left || xSvg > PAD.left + innerW) { setHover(null); return }
    const tsAtCursor = tMin + ((xSvg - PAD.left) / innerW) * (tMax - tMin)
    let best = macroRatioSeries[0]
    let bestDist = Math.abs(best.tsMs - tsAtCursor)
    for (const p of macroRatioSeries) {
      const d = Math.abs(p.tsMs - tsAtCursor)
      if (d < bestDist) { best = p; bestDist = d }
    }
    if (best.tsMs < tMin || best.tsMs > tMax) { setHover(null); return }
    const xPct = ((xAt(best.tsMs) - PAD.left) / innerW) * 100
    setHover({ tsMs: best.tsMs, ratio: best.ratio, xPct })
  }, [macroRatioSeries, tMin, tMax, xAt])
  const onLeave = useCallback(() => setHover(null), [])

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-medium text-[var(--color-fg)]">
            Ratio kT/% macro cumulativo
          </h3>
          <p className="text-xs text-[var(--color-dim)] mt-1">
            kT consumati per ogni 1 % di usage, dalla nascita sessione fino
            al tempo t. La media di questa curva ci da la conversione
            kT → %, base per la tabella throttle del Capitano.
          </p>
        </div>
        {lastPoint && (
          <div className="text-right">
            <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">corrente</div>
            <div className="text-lg font-mono text-[#ec4899]">{fmtRatio(lastPoint.ratio)}</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {RANGES.map(r => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={range === r.id}
            onClick={() => setRange(r.id)}
            className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${
              range === r.id
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-border)] text-[var(--color-dim)] hover:text-[var(--color-fg)]'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
        >
          {/* griglia orizzontale a 5 tick */}
          {Array.from({ length: 5 }).map((_, i) => {
            const y = PAD.top + (innerH * i) / 4
            const r = rMax - ((rMax - rMin) * i) / 4
            return (
              <g key={i}>
                <line x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y}
                      stroke="rgba(255,255,255,0.05)" />
                <text x={PAD.left - 6} y={y + 3} fontSize={9}
                      textAnchor="end" fill="rgba(236,72,153,0.7)" fontFamily="monospace">
                  {fmtRatio(r)}
                </text>
              </g>
            )
          })}

          {/* asse X labels: tMin e tMax */}
          <text x={PAD.left} y={H - 8} fontSize={9}
                fill="rgba(255,255,255,0.5)" fontFamily="monospace">
            {new Date(tMin).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </text>
          <text x={PAD.left + innerW} y={H - 8} fontSize={9} textAnchor="end"
                fill="rgba(255,255,255,0.5)" fontFamily="monospace">
            {new Date(tMax).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </text>

          {/* linea ratio macro continua */}
          {macroRatioSeries.length > 0 && (
            <path
              d={(() => {
                const parts: string[] = []
                for (const p of macroRatioSeries) {
                  if (p.tsMs < tMin || p.tsMs > tMax) continue
                  parts.push(`${parts.length === 0 ? 'M' : 'L'} ${xAt(p.tsMs).toFixed(1)} ${yRatio(p.ratio).toFixed(1)}`)
                }
                return parts.join(' ')
              })()}
              stroke="#ec4899"
              strokeWidth={2.5}
              fill="none"
            />
          )}

          {macroRatioSeries.length === 0 && (
            <text x={W / 2} y={H / 2} fontSize={11} textAnchor="middle"
                  fill="rgba(255,255,255,0.4)" fontFamily="monospace">
              servono ≥2 step bridge per calcolare la ratio
            </text>
          )}

          {/* Hover crosshair + dot sul punto piu' vicino */}
          {hover && (
            <>
              <line
                x1={xAt(hover.tsMs)} x2={xAt(hover.tsMs)}
                y1={PAD.top} y2={PAD.top + innerH}
                stroke="rgba(236,72,153,0.4)" strokeWidth={1}
                strokeDasharray="2 3" pointerEvents="none"
              />
              <circle
                cx={xAt(hover.tsMs)} cy={yRatio(hover.ratio)}
                r={4} fill="#ec4899" stroke="#0f172a" strokeWidth={1}
                pointerEvents="none"
              />
            </>
          )}
        </svg>

        {/* Tooltip esterno (HTML) — posizionato in % rispetto al container */}
        {hover && (
          <div
            className="absolute pointer-events-none rounded border border-[var(--color-border)] bg-[var(--color-bg)]/95 px-2 py-1 text-[11px] font-mono shadow-lg"
            style={{
              left: hover.xPct > 60 ? undefined : `calc(${hover.xPct}% + 16px)`,
              right: hover.xPct > 60 ? `calc(${100 - hover.xPct}% + 16px)` : undefined,
              top: 12,
            }}
          >
            <div className="text-[var(--color-dim)]">
              {new Date(hover.tsMs).toLocaleTimeString('it-IT', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}
            </div>
            <div className="text-[#ec4899]">{fmtRatio(hover.ratio)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
