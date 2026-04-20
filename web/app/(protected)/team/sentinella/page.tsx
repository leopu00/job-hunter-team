'use client'

import { useEffect, useState } from 'react'

type Entry = {
  ts: string
  provider: string
  usage: number
  velocity_smooth?: number
  velocity_ideal?: number
  projection?: number
  status: 'OK' | 'ATTENZIONE' | 'CRITICO' | 'SOTTOUTILIZZO' | 'RESET' | string
  throttle?: number
  reset_at?: string
}

const STATUS_COLOR: Record<string, string> = {
  OK: '#4ade80',
  SOTTOUTILIZZO: '#60a5fa',
  ATTENZIONE: '#facc15',
  CRITICO: '#f87171',
  RESET: '#a78bfa',
}

const THROTTLE_LABEL = ['T0 full', 'T1 30s', 'T2 2 min', 'T3 5 min', 'T4 10 min']

// ── SVG chart (inline, zero deps) ──────────────────────────────────
function Chart({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return (
      <div style={{ padding: '40px', opacity: 0.6, textAlign: 'center' }}>
        Nessun dato ancora. Il primo tick della Sentinella popolera il grafico.
      </div>
    )
  }

  const W = 900
  const H = 320
  const PAD = { top: 20, right: 60, bottom: 40, left: 50 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  // Asse X: indice temporale (i punti non sono equidistanti ma per ora va bene)
  const n = entries.length
  const xAt = (i: number) => PAD.left + (i / Math.max(1, n - 1)) * innerW

  // Asse Y: 0-100%
  const yAt = (v: number) => PAD.top + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH

  // Path generator
  const pathFor = (key: keyof Entry) =>
    entries
      .map((e, i) => {
        const v = e[key] as number | undefined
        if (v === undefined || v === null || Number.isNaN(v)) return null
        return `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`
      })
      .filter(Boolean)
      .join(' ')

  // Reference lines at 50%, 80%, 95%
  const refLines = [50, 80, 95, 100]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', maxWidth: W, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, background: '#0f172a' }}
    >
      {/* Ref horizontal lines */}
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
          <text x={W - PAD.right + 5} y={yAt(v) + 4} fontSize={11} fill="rgba(255,255,255,0.5)">
            {v}%
          </text>
        </g>
      ))}

      {/* Proiezione (dashed, dietro) */}
      <path d={pathFor('projection')} stroke="#a78bfa" strokeWidth={1.5} fill="none" strokeDasharray="5 4" opacity={0.7} />

      {/* Velocita ideale (pallida) */}
      <path d={pathFor('velocity_ideal')} stroke="#64748b" strokeWidth={1} fill="none" opacity={0.5} />

      {/* Usage (protagonista) */}
      <path d={pathFor('usage')} stroke="#22d3ee" strokeWidth={2.2} fill="none" />

      {/* Punti + colore stato */}
      {entries.map((e, i) => (
        <circle
          key={i}
          cx={xAt(i)}
          cy={yAt(e.usage)}
          r={3}
          fill={STATUS_COLOR[e.status] || '#22d3ee'}
          stroke="#0f172a"
          strokeWidth={1}
        >
          <title>{`${e.ts} • ${e.usage}% • ${e.status}${e.throttle !== undefined ? ' • T' + e.throttle : ''}`}</title>
        </circle>
      ))}

      {/* Axis labels */}
      <text x={PAD.left} y={H - 10} fontSize={11} fill="rgba(255,255,255,0.5)">
        {new Date(entries[0].ts).toLocaleTimeString()}
      </text>
      <text x={W - PAD.right} y={H - 10} fontSize={11} fill="rgba(255,255,255,0.5)" textAnchor="end">
        {new Date(entries[entries.length - 1].ts).toLocaleTimeString()}
      </text>

      {/* Legend */}
      <g transform={`translate(${PAD.left}, 10)`}>
        <rect x={0} y={-8} width={14} height={2} fill="#22d3ee" />
        <text x={20} y={-2} fontSize={11} fill="rgba(255,255,255,0.8)">usage</text>
        <rect x={70} y={-8} width={14} height={2} fill="#a78bfa" />
        <text x={90} y={-2} fontSize={11} fill="rgba(255,255,255,0.8)">proiezione</text>
        <rect x={170} y={-8} width={14} height={2} fill="#64748b" />
        <text x={190} y={-2} fontSize={11} fill="rgba(255,255,255,0.8)">ideale</text>
      </g>
    </svg>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] || '#94a3b8'
  return (
    <span style={{
      background: color + '20',
      color,
      border: `1px solid ${color}`,
      padding: '2px 10px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: 0.5,
    }}>
      {status}
    </span>
  )
}

// ── Page ───────────────────────────────────────────────────────────
export default function SentinellaPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    try {
      const r = await fetch('/api/sentinella/data', { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) {
        setEntries(j.entries || [])
        setErr(null)
      } else {
        setErr(j.error || 'errore sconosciuto')
      }
    } catch (e: any) {
      setErr(e?.message || 'fetch failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000) // refresh ogni 30s (tick e' ogni 10 min)
    return () => clearInterval(id)
  }, [])

  const last = entries[entries.length - 1]

  return (
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>👁️ Sentinella</h1>
        {last && <StatusBadge status={last.status} />}
      </div>
      <p style={{ opacity: 0.6, marginTop: 0, fontSize: 13 }}>
        Monitor rate-limit e budget del provider AI attivo. Aggiorna ogni 30 secondi.
      </p>

      {loading && <div style={{ padding: 40, textAlign: 'center', opacity: 0.6 }}>Caricamento…</div>}

      {err && (
        <div style={{ padding: 12, background: '#f8717110', color: '#f87171', border: '1px solid #f8717150', borderRadius: 6, marginBottom: 16 }}>
          Errore: {err}
        </div>
      )}

      {last && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Metric label="provider" value={last.provider} />
          <Metric label="usage" value={`${last.usage}%`} />
          <Metric label="vel. smussata" value={last.velocity_smooth !== undefined ? `${last.velocity_smooth}%/h` : '—'} />
          <Metric label="vel. ideale" value={last.velocity_ideal !== undefined ? `${last.velocity_ideal}%/h` : '—'} />
          <Metric label="proiezione" value={last.projection !== undefined ? `${last.projection}%` : '—'} />
          <Metric label="throttle" value={last.throttle !== undefined ? THROTTLE_LABEL[last.throttle] || '?' : '—'} />
          <Metric label="reset at" value={last.reset_at || '—'} />
          <Metric label="ultimo tick" value={new Date(last.ts).toLocaleTimeString()} />
        </div>
      )}

      <Chart entries={entries} />

      {entries.length > 0 && (
        <div style={{ marginTop: 24, fontSize: 12, opacity: 0.6 }}>
          {entries.length} campionamenti totali mostrati (ultimi 500).
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '10px 14px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 6,
    }}>
      <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>{value}</div>
    </div>
  )
}
