'use client'

// UsageChart — mini-dashboard del budget rate-limit per la pagina Team.
// Riusa gli stessi dati di /api/sentinella/data (alimentato dal bridge)
// ma con un layout compatto e un solo fetch (no start/stop, no terminale).
// Il grafico completo con controlli resta su /team/sentinella.

import { useCallback, useEffect, useState } from 'react'

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
}

const STATUS_COLOR: Record<string, string> = {
  OK: '#4ade80',
  SOTTOUTILIZZO: '#60a5fa',
  ATTENZIONE: '#facc15',
  CRITICO: '#f87171',
  RESET: '#a78bfa',
  ANOMALIA: '#fb923c',
}

function Chart({ entries }: { entries: Entry[] }) {
  const W = 900
  const H = 220
  const PAD = { top: 16, right: 56, bottom: 28, left: 44 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const n = entries.length
  const xAt = (i: number) => PAD.left + (n <= 1 ? 0.5 : i / (n - 1)) * innerW
  const yAt = (v: number) => PAD.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH

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
        >
          <title>{`${e.ts} • ${e.usage}% • ${e.status}${e.throttle !== undefined ? ' • T' + e.throttle : ''}`}</title>
        </circle>
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

export default function UsageChart() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

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

  const last = entries.length > 0 ? entries[entries.length - 1] : null

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
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
        <a
          href="/team/sentinella"
          className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline"
        >
          dettagli →
        </a>
      </div>
      {loading && entries.length === 0 ? (
        <div className="text-[11px] text-[var(--color-dim)] py-6 text-center">Caricamento…</div>
      ) : (
        <Chart entries={entries} />
      )}
    </div>
  )
}
