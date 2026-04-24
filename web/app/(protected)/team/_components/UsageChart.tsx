'use client'

// UsageChart — mini-dashboard interattivo del budget rate-limit per la
// pagina Team. Riusa gli stessi dati di /api/sentinella/data (alimentato
// dal bridge) + aggiunge:
//   - range selector (1h / 6h / 24h / all)
//   - tooltip hover con tutti i metrici del punto
//   - crosshair verticale che segue il mouse
//
// Il grafico completo con controlli e terminale resta su /team/sentinella.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Entry = {
  ts: string
  provider: string
  usage: number
  velocity_smooth?: number
  velocity_ideal?: number
  projection?: number
  status: string
  throttle?: number
  reset_at?: string
  host?: { cpu_pct?: number; ram_pct?: number } | null
  host_level?: string
}

const STATUS_COLOR: Record<string, string> = {
  OK: '#4ade80',
  SOTTOUTILIZZO: '#60a5fa',
  ATTENZIONE: '#facc15',
  CRITICO: '#f87171',
  RESET: '#a78bfa',
  ANOMALIA: '#fb923c',
}

const RANGES = [
  { id: '1h',  label: '1h',  minutes: 60 },
  { id: '6h',  label: '6h',  minutes: 6 * 60 },
  { id: '24h', label: '24h', minutes: 24 * 60 },
  { id: 'all', label: 'tutto', minutes: Infinity },
] as const
type RangeId = (typeof RANGES)[number]['id']

type HoverState = { index: number; xPct: number; yPct: number } | null

function Chart({ entries, onHover }: { entries: Entry[]; onHover: (h: HoverState) => void }) {
  const W = 900
  const H = 220
  const PAD = { top: 16, right: 56, bottom: 28, left: 44 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const svgRef = useRef<SVGSVGElement | null>(null)

  const n = entries.length
  const xAt = useCallback(
    (i: number) => PAD.left + (n <= 1 ? 0.5 : i / (n - 1)) * innerW,
    [n, innerW]
  )
  const yAt = useCallback(
    (v: number) => PAD.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH,
    [innerH]
  )

  const pathFor = (key: keyof Entry) =>
    entries
      .map((e, i) => {
        const v = e[key] as number | undefined
        if (v === undefined || v === null || Number.isNaN(v)) return null
        return `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`
      })
      .filter(Boolean)
      .join(' ')

  const refLines = [50, 80, 95, 100]

  // Mouse → nearest point index. SVG usa coordinate viewBox, il mouse
  // arriva in pixel → scaliamo tramite getBoundingClientRect.
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || n === 0) return
    const rect = svg.getBoundingClientRect()
    const pxX = e.clientX - rect.left
    const vbX = (pxX / rect.width) * W
    // Map vbX → index: inverse di xAt. xAt(i) = PAD.left + i/(n-1) * innerW.
    const rel = Math.max(0, Math.min(1, (vbX - PAD.left) / innerW))
    const idx = n <= 1 ? 0 : Math.round(rel * (n - 1))
    onHover({
      index: idx,
      xPct: (xAt(idx) / W) * 100,
      yPct: (yAt(entries[idx].usage) / H) * 100,
    })
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
      style={{
        width: '100%',
        maxWidth: W,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-panel)',
        display: 'block',
        cursor: n > 0 ? 'crosshair' : 'default',
      }}
    >
      {refLines.map(v => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yAt(v)}
            y2={yAt(v)}
            stroke={v === 100 ? '#f87171' : v === 95 ? '#facc15' : 'rgba(255,255,255,0.08)'}
            strokeDasharray={v >= 95 ? '4 4' : '2 6'}
            strokeWidth={v >= 95 ? 1 : 0.5}
          />
          <text x={W - PAD.right + 5} y={yAt(v) + 4} fontSize={10} fill="rgba(255,255,255,0.5)">
            {v}%
          </text>
        </g>
      ))}

      <path d={pathFor('projection')} stroke="#a78bfa" strokeWidth={1.3} fill="none" strokeDasharray="5 4" opacity={0.7} />
      <path d={pathFor('velocity_ideal')} stroke="#64748b" strokeWidth={1} fill="none" opacity={0.5} />
      <path d={pathFor('usage')} stroke="#22d3ee" strokeWidth={2} fill="none" />

      {entries.map((e, i) => (
        <circle
          key={i}
          cx={xAt(i)}
          cy={yAt(e.usage)}
          r={2.6}
          fill={STATUS_COLOR[e.status] || '#22d3ee'}
          stroke="#0f172a"
          strokeWidth={1}
        />
      ))}

      {entries.length > 0 && (
        <>
          <text x={PAD.left} y={H - 8} fontSize={10} fill="rgba(255,255,255,0.5)">
            {new Date(entries[0].ts).toLocaleTimeString()}
          </text>
          <text x={W - PAD.right} y={H - 8} fontSize={10} fill="rgba(255,255,255,0.5)" textAnchor="end">
            {new Date(entries[entries.length - 1].ts).toLocaleTimeString()}
          </text>
        </>
      )}

      {entries.length === 0 && (
        <text
          x={PAD.left + innerW / 2}
          y={PAD.top + innerH / 2}
          fontSize={12}
          fill="rgba(255,255,255,0.45)"
          textAnchor="middle"
        >
          In attesa del primo tick del bridge…
        </text>
      )}

      <g transform={`translate(${PAD.left}, 10)`}>
        <rect x={0} y={-7} width={12} height={2} fill="#22d3ee" />
        <text x={16} y={-2} fontSize={10} fill="rgba(255,255,255,0.8)">usage</text>
        <rect x={62} y={-7} width={12} height={2} fill="#a78bfa" />
        <text x={78} y={-2} fontSize={10} fill="rgba(255,255,255,0.8)">proiezione</text>
        <rect x={148} y={-7} width={12} height={2} fill="#64748b" />
        <text x={164} y={-2} fontSize={10} fill="rgba(255,255,255,0.8)">ideale</text>
      </g>
    </svg>
  )
}

function Tooltip({ entry }: { entry: Entry }) {
  const ts = new Date(entry.ts)
  const cpu = entry.host?.cpu_pct
  const ram = entry.host?.ram_pct
  return (
    <div className="pointer-events-none">
      <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
        {ts.toLocaleTimeString()} · {ts.toLocaleDateString()}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
        <div>
          <span className="text-[var(--color-dim)]">usage:</span>{' '}
          <span className="text-[var(--color-bright)] font-semibold">{entry.usage}%</span>
        </div>
        {entry.projection !== undefined && entry.projection !== null && (
          <div>
            <span className="text-[var(--color-dim)]">proj:</span>{' '}
            <span style={{ color: '#a78bfa' }}>{Math.round(entry.projection)}%</span>
          </div>
        )}
        {entry.velocity_smooth !== undefined && (
          <div>
            <span className="text-[var(--color-dim)]">vel:</span>{' '}
            <span className="text-[var(--color-muted)]">{entry.velocity_smooth.toFixed(1)}%/h</span>
          </div>
        )}
        {entry.velocity_ideal !== undefined && entry.velocity_ideal !== null && (
          <div>
            <span className="text-[var(--color-dim)]">ideal:</span>{' '}
            <span className="text-[var(--color-muted)]">{entry.velocity_ideal.toFixed(1)}%/h</span>
          </div>
        )}
        <div>
          <span className="text-[var(--color-dim)]">status:</span>{' '}
          <span style={{ color: STATUS_COLOR[entry.status] || 'var(--color-muted)' }}>{entry.status}</span>
        </div>
        <div>
          <span className="text-[var(--color-dim)]">throttle:</span>{' '}
          <span className="text-[var(--color-muted)]">T{entry.throttle ?? 0}</span>
        </div>
        {cpu !== undefined && (
          <div>
            <span className="text-[var(--color-dim)]">cpu:</span>{' '}
            <span className="text-[var(--color-muted)]">{cpu}%</span>
          </div>
        )}
        {ram !== undefined && (
          <div>
            <span className="text-[var(--color-dim)]">ram:</span>{' '}
            <span className="text-[var(--color-muted)]">{ram}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function UsageChart() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeId>('6h')
  const [hover, setHover] = useState<HoverState>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const loadData = useCallback(async () => {
    try {
      const r = await fetch('/api/sentinella/data', { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) setEntries(j.entries || [])
    } catch { /* best-effort */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 30_000)
    return () => clearInterval(id)
  }, [loadData])

  // Filtra per range. "all" disattiva il filtro. Calcolato con useMemo
  // per evitare ricalcoli ad ogni hover (che resetterebbe il picking).
  const filtered = useMemo(() => {
    const meta = RANGES.find(r => r.id === range) ?? RANGES[1]
    if (!Number.isFinite(meta.minutes)) return entries
    const cutoff = Date.now() - meta.minutes * 60_000
    return entries.filter(e => {
      const t = Date.parse(e.ts)
      return Number.isFinite(t) && t >= cutoff
    })
  }, [entries, range])

  const last = filtered.length > 0 ? filtered[filtered.length - 1] : null
  const hovered = hover && filtered[hover.index] ? filtered[hover.index] : null

  return (
    <div ref={containerRef}>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-dim)]">Rate budget</span>
          {last && (
            <>
              <span className="text-[11px] text-[var(--color-muted)]">
                {last.provider} · {last.usage}% · T{last.throttle ?? 0}
              </span>
              <span className="text-[10px]" style={{ color: STATUS_COLOR[last.status] || 'var(--color-muted)' }}>
                {last.status}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
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
          <a
            href="/team/sentinella"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline"
          >
            dettagli →
          </a>
        </div>
      </div>

      {loading && filtered.length === 0 ? (
        <div className="text-[11px] text-[var(--color-dim)] py-6 text-center">Caricamento…</div>
      ) : (
        <div className="relative">
          <Chart entries={filtered} onHover={setHover} />

          {/* Crosshair + tooltip overlay — posizionati in % sopra l'SVG */}
          {hover && hovered && (
            <>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 w-px"
                style={{
                  left: `${hover.xPct}%`,
                  background: 'rgba(255,255,255,0.2)',
                }}
              />
              <div
                className="absolute z-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 shadow-lg"
                style={{
                  left: hover.xPct > 55 ? undefined : `calc(${hover.xPct}% + 12px)`,
                  right: hover.xPct > 55 ? `calc(${100 - hover.xPct}% + 12px)` : undefined,
                  top: hover.yPct > 50 ? '8px' : undefined,
                  bottom: hover.yPct > 50 ? undefined : '8px',
                  minWidth: 220,
                }}
              >
                <Tooltip entry={hovered} />
              </div>
            </>
          )}
        </div>
      )}

      {filtered.length === 0 && !loading && entries.length > 0 && (
        <div className="text-[10px] text-[var(--color-dim)] text-center mt-2">
          Nessun sample nell'intervallo selezionato — prova "tutto".
        </div>
      )}
    </div>
  )
}
