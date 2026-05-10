'use client'

// TokenTypesChart — composizione del consumo team per tipo di token.
//
// 4 linee cumulative: input_other, output, cache_read, cache_creation.
// Permette di vedere COSA stiamo consumando (non solo quanto). Utile
// per:
//   • verificare se i pesi del rate limit sono coerenti col mix osservato
//   • identificare cache pattern (es. cache_read che esplode = sessione
//     lunga con riuso forte del context)
//   • futuro: calibrare i 4 pesi via least-squares ai step events del bridge.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Series = Array<{
  ts: string
  input_kt: number
  output_kt: number
  cache_read_kt: number
  cache_creation_kt: number
}>

type ApiResponse = {
  ok: boolean
  series: Series
  totals_kt: {
    input: number
    output: number
    cache_read: number
    cache_creation: number
  }
  events_count: number
}

const RANGES = [
  { id: '10m', label: '10m', minutes: 10 },
  { id: '30m', label: '30m', minutes: 30 },
  { id: '1h',  label: '1h',  minutes: 60 },
  { id: '6h',  label: '6h',  minutes: 360 },
  { id: '24h', label: '24h', minutes: 1440 },
] as const
type RangeId = (typeof RANGES)[number]['id']

const TYPES = [
  { key: 'input_kt' as const,          label: 'input (no cache)', color: '#22d3ee' }, // ciano
  { key: 'output_kt' as const,         label: 'output',           color: '#fb923c' }, // arancione
  { key: 'cache_read_kt' as const,     label: 'cache read',       color: '#a78bfa' }, // viola
  { key: 'cache_creation_kt' as const, label: 'cache creation',   color: '#fde047' }, // giallo
]

function fmtKt(v: number): string {
  if (v < 1) return `${v.toFixed(2)} kT`
  if (v < 1000) return `${v.toFixed(1)} kT`
  return `${(v / 1000).toFixed(2)} MT`
}

function Chart({
  data, tMin, tMax, hidden,
}: {
  data: Series
  tMin: number
  tMax: number
  hidden: Record<string, boolean>
}) {
  const W = 1200
  const H = 420
  const PAD = { top: 30, right: 20, bottom: 32, left: 60 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const tSpan = Math.max(1, tMax - tMin)
  const xAt = useCallback(
    (ts: number) => PAD.left + ((ts - tMin) / tSpan) * innerW,
    [tMin, tSpan, innerW],
  )

  // Auto-zoom Y sulle SOLE serie visibili (non hidden) — così se nascondi
  // cache_read che domina, lo zoom si stringe sulle altre 3 e le rendi
  // leggibili.
  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const row of data) {
      const t = Date.parse(row.ts)
      if (!Number.isFinite(t) || t < tMin || t > tMax) continue
      for (const tp of TYPES) {
        if (hidden[tp.key]) continue
        const v = row[tp.key]
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { yMin: 0, yMax: 1 }
    if (hi - lo < 0.01) return { yMin: Math.max(0, lo - 0.5), yMax: hi + 0.5 }
    const range = hi - lo
    const pad = range * 0.1
    return { yMin: Math.max(0, lo - pad), yMax: hi + pad }
  }, [data, tMin, tMax, hidden])

  const ySpan = Math.max(0.001, yMax - yMin)
  const yAt = useCallback(
    (v: number) => PAD.top + innerH - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / ySpan) * innerH,
    [innerH, yMin, yMax, ySpan],
  )

  const GAP_MS = 12 * 60 * 1000

  const pathFor = (key: keyof Series[number]) => {
    const parts: string[] = []
    let prevTs: number | null = null
    for (const row of data) {
      const t = Date.parse(row.ts)
      if (!Number.isFinite(t) || t < tMin || t > tMax) { prevTs = null; continue }
      const v = row[key] as number
      if (typeof v !== 'number' || !Number.isFinite(v)) { prevTs = null; continue }
      const isGap = prevTs !== null && (t - prevTs) > GAP_MS
      const cmd = parts.length === 0 || isGap ? 'M' : 'L'
      parts.push(`${cmd} ${xAt(t).toFixed(1)} ${yAt(v).toFixed(1)}`)
      prevTs = t
    }
    return parts.join(' ')
  }

  // Ref-lines orizzontali, 5 step
  const refLines = useMemo(() => {
    const out: number[] = []
    const step = (yMax - yMin) / 4
    for (let i = 0; i <= 4; i++) out.push(yMin + i * step)
    return out
  }, [yMin, yMax])

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: '100%',
        maxWidth: W,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-panel)',
        display: 'block',
      }}
    >
      {refLines.map((v, i) => (
        <g key={i}>
          <line
            x1={PAD.left} x2={W - PAD.right}
            y1={yAt(v)} y2={yAt(v)}
            stroke="rgba(255,255,255,0.08)" strokeDasharray="2 6" strokeWidth={0.5}
          />
          <text
            x={PAD.left - 6}
            y={yAt(v) + 4}
            fontSize={10}
            fill="rgba(255,255,255,0.5)"
            fontFamily="monospace"
            textAnchor="end"
          >
            {fmtKt(v)}
          </text>
        </g>
      ))}

      {TYPES.filter(tp => !hidden[tp.key]).map(tp => (
        <path
          key={tp.key}
          d={pathFor(tp.key)}
          stroke={tp.color}
          strokeWidth={1.6}
          fill="none"
          opacity={0.9}
        />
      ))}

      <text x={PAD.left} y={H - 8} fontSize={10} fill="rgba(255,255,255,0.5)">
        {new Date(tMin).toLocaleTimeString()}
      </text>
      <text x={W - PAD.right} y={H - 8} fontSize={10} fill="rgba(255,255,255,0.5)" textAnchor="end">
        {new Date(tMax).toLocaleTimeString()}
      </text>

      {data.length === 0 && (
        <text
          x={PAD.left + innerW / 2}
          y={PAD.top + innerH / 2}
          fontSize={12}
          fill="rgba(255,255,255,0.45)"
          textAnchor="middle"
        >
          In attesa dati…
        </text>
      )}
    </svg>
  )
}

export default function TokenTypesChart() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeId>('30m')
  const [nowTs, setNowTs] = useState(() => Date.now())
  // Toggle per nascondere/mostrare ogni serie. Default: cache_read OFF
  // perché è 60-100× le altre 3 e le schiaccia visivamente — l'utente
  // tipicamente vuole prima vedere input/output, poi accendere cache_read
  // per confronto. Toggle persistito solo in memory (no localStorage).
  const [hidden, setHidden] = useState<Record<string, boolean>>({
    cache_read_kt: true,
  })

  const minutes = useMemo(
    () => RANGES.find(r => r.id === range)?.minutes ?? 30,
    [range],
  )

  const load = useCallback(async () => {
    const sinceMin = Math.max(10, Math.min(24 * 60, minutes))
    const bucketSec = sinceMin > 6 * 60 ? 300 : 60
    try {
      const r = await fetch(
        `/api/tokens/by-type?sinceMin=${sinceMin}&bucketSec=${bucketSec}`,
        { cache: 'no-store' },
      )
      const j: ApiResponse = await r.json()
      if (j.ok) setData(j)
    } catch { /* best-effort */ }
    finally { setLoading(false) }
  }, [minutes])

  useEffect(() => {
    setLoading(true)
    load()
    const id = setInterval(load, 30_000)
    const clockId = setInterval(() => setNowTs(Date.now()), 10_000)
    return () => { clearInterval(id); clearInterval(clockId) }
  }, [load])

  const tMax = nowTs
  const tMin = nowTs - minutes * 60_000

  const totals = data?.totals_kt
  const totalAll = totals
    ? totals.input + totals.output + totals.cache_read + totals.cache_creation
    : 0

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-dim)]">
            Composizione consumo per tipo di token
          </span>
          {totals && (
            <span className="text-[11px] text-[var(--color-muted)]">
              tot {fmtKt(totalAll)} ·{' '}
              <span style={{ color: '#22d3ee' }}>in {fmtKt(totals.input)}</span> ·{' '}
              <span style={{ color: '#fb923c' }}>out {fmtKt(totals.output)}</span> ·{' '}
              <span style={{ color: '#a78bfa' }}>cR {fmtKt(totals.cache_read)}</span> ·{' '}
              <span style={{ color: '#fde047' }}>cC {fmtKt(totals.cache_creation)}</span>
            </span>
          )}
        </div>
        <div className="flex gap-1" role="radiogroup" aria-label="time range">
          {RANGES.map(r => {
            const active = r.id === range
            return (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setRange(r.id)}
                className="px-2 py-0.5 rounded text-[10px] font-semibold transition-colors"
                style={{
                  background: active ? 'rgba(34,211,238,0.15)' : 'transparent',
                  color: active ? '#22d3ee' : 'var(--color-dim)',
                  border: `1px solid ${active ? 'rgba(34,211,238,0.4)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {r.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading && !data ? (
        <div className="text-[11px] text-[var(--color-dim)] py-6 text-center">Caricamento…</div>
      ) : (
        <>
          <Chart data={data?.series ?? []} tMin={tMin} tMax={tMax} hidden={hidden} />
          <div className="px-1 mt-2 text-[10px] text-[var(--color-muted)] flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[var(--color-dim)]">click per nascondere/mostrare:</span>
            {TYPES.map(tp => {
              const off = hidden[tp.key]
              return (
                <button
                  key={tp.key}
                  type="button"
                  onClick={() => setHidden(h => ({ ...h, [tp.key]: !h[tp.key] }))}
                  className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded transition-opacity"
                  style={{
                    background: off ? 'transparent' : 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    opacity: off ? 0.4 : 1,
                    fontFamily: 'inherit',
                    color: 'inherit',
                    fontSize: 10,
                  }}
                  aria-pressed={!off}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block', width: 14, height: 2,
                      background: tp.color,
                      opacity: off ? 0.3 : 1,
                    }}
                  />
                  {tp.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
