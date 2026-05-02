'use client'

// AgentTokensChart — consumo cumulativo di token per agente nel tempo.
// Dato sorgente: /api/tokens/by-agent (alimentato dallo script python
// shared/skills/token-by-agent-series.py che legge i wire.jsonl Kimi).
//
// Mostrato sotto UsageChart (rate budget). Mentre UsageChart racconta
// "quanto budget abbiamo usato col provider", questo grafico spacca il
// consumo per agente in modo da vedere chi pesa di più — utile per
// decidere allocazioni / throttle differenziato in futuro.

import { useEffect, useMemo, useRef, useState } from 'react'
import { colorForAgent as colorFor } from './agent-colors'

type Series = Record<string, number | string>

type Payload = {
  ok: boolean
  now: string
  since: string
  bucket_sec: number
  agents: string[]
  totals_kt: Record<string, number>
  events: Record<string, number>
  series: Series[]
}

const RANGES = [
  { id: '1m',  label: '1m',  minutes: 1 },
  { id: '5m',  label: '5m',  minutes: 5 },
  { id: '10m', label: '10m', minutes: 10 },
  { id: '30m', label: '30m', minutes: 30 },
  { id: '1h',  label: '1h',  minutes: 60 },
  { id: '3h',  label: '3h',  minutes: 180 },
  { id: '6h',  label: '6h',  minutes: 360 },
] as const
type RangeId = (typeof RANGES)[number]['id']

type Mode = 'cumulative' | 'rate'

export default function AgentTokensChart() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeId>('3h')
  const [mode, setMode] = useState<Mode>('cumulative')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const minutes = RANGES.find(r => r.id === range)?.minutes ?? 180
    // Bucket size si adatta al range: 30m → 15s, 1h → 30s, 3h → 60s, 6h → 120s.
    // Mantiene ~120 punti, leggibile e leggero.
    const bucketSec = Math.max(1, Math.round((minutes * 60) / 120))

    setLoading(true)
    setError(null)
    fetch(`/api/tokens/by-agent?sinceMin=${minutes}&bucketSec=${bucketSec}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((d: Payload) => {
        if (cancelled) return
        if (!d.ok) {
          setError('Risposta non valida')
          setData(null)
        } else {
          setData(d)
        }
      })
      .catch(e => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [range])

  // Polling ogni 30s (rivisita stesso range)
  useEffect(() => {
    const id = setInterval(() => {
      const minutes = RANGES.find(r => r.id === range)?.minutes ?? 180
      const bucketSec = Math.max(1, Math.round((minutes * 60) / 120))
      fetch(`/api/tokens/by-agent?sinceMin=${minutes}&bucketSec=${bucketSec}`, { cache: 'no-store' })
        .then(r => r.json())
        .then((d: Payload) => { if (d.ok) setData(d) })
        .catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [range])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-bright)]">
            Token per agente
          </h2>
          <p className="text-[10px] text-[var(--color-dim)] mt-0.5">
            {mode === 'cumulative'
              ? 'Consumo cumulativo weighted (Kimi · wire.jsonl). Aggiornamento ogni 30s.'
              : 'Velocità di consumo per bucket — kT/min weighted. Aggiornamento ogni 30s.'}
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className="px-2.5 py-1 rounded text-[10px] font-medium transition-colors"
              style={{
                background: range === r.id ? 'rgba(34,211,238,0.15)' : 'transparent',
                color: range === r.id ? '#22d3ee' : 'var(--color-dim)',
                border: `1px solid ${range === r.id ? 'rgba(34,211,238,0.35)' : 'var(--color-border)'}`,
                cursor: 'pointer',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toggle Cumulativo / Rate */}
      <div className="mb-3 flex gap-1">
        {([
          { id: 'cumulative', label: 'Cumulativo' },
          { id: 'rate', label: 'Rate (kT/min)' },
        ] as const).map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className="px-3 py-1 rounded text-[10px] font-medium transition-colors"
            style={{
              background: mode === m.id ? 'rgba(168,139,250,0.15)' : 'transparent',
              color: mode === m.id ? '#a78bfa' : 'var(--color-dim)',
              border: `1px solid ${mode === m.id ? 'rgba(168,139,250,0.35)' : 'var(--color-border)'}`,
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading && !data && (
        <div className="h-[280px] flex items-center justify-center text-[11px] text-[var(--color-dim)]">
          loading…
        </div>
      )}
      {error && !data && (
        <div className="h-[280px] flex items-center justify-center text-[11px] text-[var(--color-warn,#f87171)]">
          {error}
        </div>
      )}
      {data && data.agents.length === 0 && (
        <div className="h-[280px] flex items-center justify-center text-[11px] text-[var(--color-dim)]">
          Nessun dato nel range selezionato.
        </div>
      )}
      {data && data.agents.length > 0 && (
        <Chart data={data} mode={mode} hoverIdx={hoverIdx} onHover={setHoverIdx} />
      )}
    </div>
  )
}

function Chart({
  data, mode, hoverIdx, onHover,
}: {
  data: Payload
  mode: Mode
  hoverIdx: number | null
  onHover: (i: number | null) => void
}) {
  const W = 900
  const H = 320
  const PAD = { top: 16, right: 24, bottom: 28, left: 56 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const svgRef = useRef<SVGSVGElement | null>(null)
  // posizione cursor in % sopra il wrapper, per il tooltip floating
  // (stesso pattern di ThrottleChart/UsageChart)
  const [hoverPos, setHoverPos] = useState<{ xPct: number; yPct: number } | null>(null)

  // Serie visibile derivata dal mode:
  //   cumulative → valori grezzi dal backend (kT cumulati)
  //   rate       → delta bucket-to-bucket convertito in kT/min
  // Lavoriamo su `display`: lista di Record agent→number, stesso shape
  // della series originale ma con l'unità giusta. Il primo bucket in mode
  // 'rate' è 0 per tutti (nessun bucket precedente da cui calcolare delta).
  const display = useMemo(() => {
    if (mode === 'cumulative') {
      return data.series.map(row => {
        const out: Record<string, number> = {}
        for (const a of data.agents) {
          const v = row[a]
          out[a] = typeof v === 'number' ? v : 0
        }
        return out
      })
    }
    // rate: delta * 60 / bucket_sec → kT/min
    const factor = 60 / Math.max(1, data.bucket_sec)
    const rows: Record<string, number>[] = []
    for (let i = 0; i < data.series.length; i++) {
      const out: Record<string, number> = {}
      for (const a of data.agents) {
        const cur = data.series[i][a]
        const prev = i > 0 ? data.series[i - 1][a] : cur
        const dCur = typeof cur === 'number' ? cur : 0
        const dPrev = typeof prev === 'number' ? prev : 0
        const delta = Math.max(0, dCur - dPrev)
        out[a] = delta * factor
      }
      rows.push(out)
    }
    return rows
  }, [data, mode])

  // Y-max: max valore visibile di qualsiasi agente, +10% margine
  const yMax = useMemo(() => {
    let m = 0
    for (const row of display) {
      for (const a of data.agents) {
        const v = row[a]
        if (typeof v === 'number' && v > m) m = v
      }
    }
    return m > 0 ? m * 1.1 : 1
  }, [display, data.agents])

  const n = data.series.length
  const xAt = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yAt = (v: number) => PAD.top + innerH - (v / yMax) * innerH

  const paths = useMemo(() => {
    return data.agents.map(agent => {
      const pts: string[] = []
      for (let i = 0; i < display.length; i++) {
        const v = display[i][agent] ?? 0
        const y = yAt(v)
        const x = xAt(i)
        pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
      }
      return { agent, d: pts.join(' '), color: colorFor(agent) }
    })
  }, [display, data.agents, yMax]) // eslint-disable-line react-hooks/exhaustive-deps

  // Asse Y: 4 livelli
  const yTicks = useMemo(() => {
    const ticks = []
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4
      ticks.push({ v, y: yAt(v) })
    }
    return ticks
  }, [yMax]) // eslint-disable-line react-hooks/exhaustive-deps

  // Asse X: 5 timestamp evenly spaced
  const xTicks = useMemo(() => {
    if (n === 0) return []
    const ticks = []
    const k = Math.min(5, n)
    for (let i = 0; i < k; i++) {
      const idx = Math.round((i / (k - 1)) * (n - 1))
      const ts = data.series[idx]?.ts as string | undefined
      const label = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
      ticks.push({ x: xAt(idx), label })
    }
    return ticks
  }, [data, n]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const xPx = e.clientX - rect.left
    const yPx = e.clientY - rect.top
    const xViewBox = (xPx / rect.width) * W
    if (xViewBox < PAD.left || xViewBox > W - PAD.right) {
      onHover(null)
      setHoverPos(null)
      return
    }
    const ratio = (xViewBox - PAD.left) / innerW
    const idx = Math.round(ratio * (n - 1))
    onHover(Math.max(0, Math.min(n - 1, idx)))
    setHoverPos({
      xPct: (xPx / rect.width) * 100,
      yPct: (yPx / rect.height) * 100,
    })
  }

  const handleLeave = () => {
    onHover(null)
    setHoverPos(null)
  }

  // hoverRow va preso dalla serie *visibile* (display), non dal raw, così
  // tooltip e marker mostrano il valore della modalità corrente.
  const hoverRow = hoverIdx !== null ? display[hoverIdx] : null
  const hoverTs = hoverIdx !== null ? (data.series[hoverIdx]?.ts as string | undefined) : undefined
  // agenti con valore > 0 nel bucket hover-ato, ordinati desc per valore
  const hoverActive = hoverRow
    ? data.agents
        .map(a => ({ agent: a, v: typeof hoverRow[a] === 'number' ? (hoverRow[a] as number) : 0 }))
        .filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v)
    : []
  const unit = mode === 'rate' ? ' kT/min' : ' kT'
  const fmt = (v: number) => `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${unit}`

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={{ display: 'block' }}
      >
        {/* griglia Y */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={t.y} y2={t.y}
              stroke="var(--color-border)" strokeDasharray="3 4" opacity={0.4}
            />
            <text x={PAD.left - 8} y={t.y + 3} fontSize={10}
                  fill="var(--color-dim)" textAnchor="end">
              {t.v.toFixed(t.v >= 100 ? 0 : t.v >= 10 ? 1 : 2)}{mode === 'rate' ? ' kT/min' : ' kT'}
            </text>
          </g>
        ))}
        {/* asse X labels */}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - PAD.bottom + 14}
                fontSize={10} fill="var(--color-dim)" textAnchor="middle">
            {t.label}
          </text>
        ))}
        {/* linee per agente */}
        {paths.map(p => (
          <path key={p.agent} d={p.d} stroke={p.color} strokeWidth={1.8} fill="none" opacity={0.92} />
        ))}
        {/* crosshair */}
        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)} x2={xAt(hoverIdx)}
            y1={PAD.top} y2={H - PAD.bottom}
            stroke="rgba(255,255,255,0.25)" strokeWidth={1}
          />
        )}
        {/* marker hover */}
        {hoverIdx !== null && data.agents.map(a => {
          const v = hoverRow?.[a]
          if (typeof v !== 'number') return null
          return (
            <circle key={a} cx={xAt(hoverIdx)} cy={yAt(v)} r={3.2}
                    fill={colorFor(a)} stroke="#0a0a0a" strokeWidth={1} />
          )
        })}
      </svg>

      {/* Tooltip floating on hover — stesso pattern di ThrottleChart/UsageChart */}
      {hoverPos && hoverActive.length > 0 && hoverTs && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 shadow-lg"
          style={{
            left: hoverPos.xPct > 55 ? undefined : `calc(${hoverPos.xPct}% + 12px)`,
            right: hoverPos.xPct > 55 ? `calc(${100 - hoverPos.xPct}% + 12px)` : undefined,
            top: hoverPos.yPct > 50 ? '8px' : undefined,
            bottom: hoverPos.yPct > 50 ? undefined : '8px',
            minWidth: 180,
          }}
        >
          <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
            {new Date(hoverTs).toLocaleTimeString()}
            <span className="ml-1 opacity-60">
              {mode === 'cumulative' ? '· cumulativo' : '· rate'}
            </span>
          </div>
          <div className="mt-1.5 grid gap-1 text-[11px] font-mono">
            {hoverActive.map(({ agent, v }) => (
              <div key={agent} className="flex items-center gap-2">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(agent), flexShrink: 0 }} />
                <span className="text-[var(--color-bright)]">{agent}</span>
                <span className="ml-auto text-[var(--color-muted)]">{fmt(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legenda + totali */}
      <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 text-[10px]">
        {data.agents.map(a => {
          const total = data.totals_kt[a] ?? 0
          const ev = data.events[a] ?? 0
          const hoverV = typeof hoverRow?.[a] === 'number' ? (hoverRow[a] as number) : null
          return (
            <div key={a} className="flex items-center gap-1.5 px-2 py-1 rounded"
                 style={{ background: 'var(--color-surface, rgba(255,255,255,0.02))', border: '1px solid var(--color-border)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colorFor(a), flexShrink: 0 }} />
              <span className="font-mono text-[var(--color-bright)] truncate" title={a}>
                {a}
              </span>
              <span className="ml-auto text-[var(--color-dim)] tabular-nums">
                {hoverV !== null
                  ? `${hoverV.toFixed(hoverV >= 100 ? 0 : hoverV >= 10 ? 1 : 2)}${mode === 'rate' ? ' kT/min' : ' kT'}`
                  : `${total.toFixed(1)} kT`}
                <span className="ml-1 opacity-60">· {ev}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
