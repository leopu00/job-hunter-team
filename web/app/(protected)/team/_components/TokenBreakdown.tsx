'use client'

// TokenBreakdown — distribuzione consumo token per agente.
//   • Pie chart a sinistra: chi consuma quanti token weighted nella finestra
//   • Widget lista a destra: agente, totale kT, media kT/min, barra share %
//
// Sorgente: /api/tokens/by-agent (stesso endpoint di UsageChart). Mostra solo
// agenti attivi (con almeno 1 evento nella finestra). Finestra selezionabile
// dall'utente — corta (10m) per "chi sta consumando ADESSO", lunga (6h) per
// "chi ha dominato la sessione".

import { useCallback, useEffect, useMemo, useState } from 'react'
import { colorForAgent } from './agent-colors'

const WINDOWS = [
  { id: '10m', label: '10m', minutes: 10 },
  { id: '30m', label: '30m', minutes: 30 },
  { id: '1h',  label: '1h',  minutes: 60 },
  { id: '6h',  label: '6h',  minutes: 360 },
] as const
type WindowId = (typeof WINDOWS)[number]['id']

type ApiResponse = {
  ok: boolean
  totals_kt: Record<string, number>
  events: Record<string, number>
  agents: string[]
}

function Pie({ slices, size = 220 }: { slices: { agent: string; kt: number; color: string }[]; size?: number }) {
  const r = size / 2 - 4
  const cx = size / 2
  const cy = size / 2
  const total = slices.reduce((s, x) => s + x.kt, 0)

  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Nessun consumo nella finestra">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth={1} strokeDasharray="3 4" />
        <text x={cx} y={cy + 4} fontSize={11} fill="var(--color-dim)" textAnchor="middle">
          nessun consumo
        </text>
      </svg>
    )
  }

  // Single-slice degenerate: 1 solo agente nella finestra → cerchio pieno
  // (path con due archi sullo stesso punto produce SVG vuoto).
  if (slices.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill={slices[0].color} stroke="#0f172a" strokeWidth={1} />
        <text x={cx} y={cy + 4} fontSize={11} fill="#0f172a" textAnchor="middle" fontWeight={700}>
          {slices[0].agent}
        </text>
      </svg>
    )
  }

  let cumAngle = -Math.PI / 2 // start at 12 o'clock
  const paths = slices.map((s) => {
    const frac = s.kt / total
    const angle = frac * 2 * Math.PI
    const x1 = cx + r * Math.cos(cumAngle)
    const y1 = cy + r * Math.sin(cumAngle)
    const endA = cumAngle + angle
    const x2 = cx + r * Math.cos(endA)
    const y2 = cy + r * Math.sin(endA)
    const largeArc = angle > Math.PI ? 1 : 0
    const d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
    cumAngle = endA
    return { d, color: s.color, agent: s.agent, frac }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribuzione token per agente">
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.color} stroke="#0f172a" strokeWidth={1}>
          <title>{p.agent}: {(p.frac * 100).toFixed(1)}%</title>
        </path>
      ))}
    </svg>
  )
}

export default function TokenBreakdown() {
  const [windowId, setWindowId] = useState<WindowId>('30m')
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const minutes = useMemo(
    () => WINDOWS.find(w => w.id === windowId)?.minutes ?? 30,
    [windowId],
  )

  const load = useCallback(async () => {
    try {
      // bucket-sec massimo per ridurre payload — qui non ci serve la
      // serie temporale, solo i totali nella finestra.
      const r = await fetch(
        `/api/tokens/by-agent?sinceMin=${minutes}&bucketSec=600`,
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
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [load])

  // Lista agenti attivi nella finestra (events > 0), ordinata per kT decrescente.
  // Calcoliamo media kT/min sull'intera finestra anche per agenti che hanno
  // consumato a burst — è la metrica che il Capitano usa per decidere il
  // throttle differenziato (chi consuma di più riceve throttle più alto).
  const rows = useMemo(() => {
    if (!data) return []
    const totals = data.totals_kt || {}
    const events = data.events || {}
    const items = Object.keys(totals)
      .filter(a => (events[a] ?? 0) > 0 && (totals[a] ?? 0) > 0)
      .map(a => ({
        agent: a,
        kt: totals[a],
        events: events[a],
        avgRate: totals[a] / minutes, // kT/min
        color: colorForAgent(a),
      }))
      .sort((a, b) => b.kt - a.kt)
    return items
  }, [data, minutes])

  const totalKt = rows.reduce((s, r) => s + r.kt, 0)
  const teamAvg = totalKt / minutes // kT/min team

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-dim)]">
            Chi consuma quanti token
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">
            {rows.length} agenti attivi · team avg {teamAvg.toFixed(1)} kT/min
          </span>
        </div>
        <div className="flex gap-1" role="radiogroup" aria-label="time window">
          {WINDOWS.map(w => {
            const active = w.id === windowId
            return (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setWindowId(w.id)}
                className="px-2 py-0.5 rounded text-[10px] font-semibold transition-colors"
                style={{
                  background: active ? 'rgba(34,211,238,0.15)' : 'transparent',
                  color: active ? '#22d3ee' : 'var(--color-dim)',
                  border: `1px solid ${active ? 'rgba(34,211,238,0.4)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {w.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading && !data ? (
        <div className="text-[11px] text-[var(--color-dim)] py-6 text-center">Caricamento…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 items-start">
          <div className="flex justify-center md:justify-start">
            <Pie slices={rows.map(r => ({ agent: r.agent, kt: r.kt, color: r.color }))} size={240} />
          </div>

          <div>
            {rows.length === 0 ? (
              <div className="text-[11px] text-[var(--color-dim)] py-3">
                Nessun agente ha consumato token negli ultimi {windowId}.
              </div>
            ) : (
              <div className="space-y-1.5">
                {rows.map(r => {
                  const sharePct = totalKt > 0 ? (r.kt / totalKt) * 100 : 0
                  return (
                    <div
                      key={r.agent}
                      className="grid grid-cols-[110px_1fr_auto] items-center gap-3 px-2 py-1.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.02)' }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          aria-hidden="true"
                          style={{
                            display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                            background: r.color, flexShrink: 0,
                          }}
                        />
                        <span className="text-[11px] text-[var(--color-bright)] font-mono truncate">
                          {r.agent}
                        </span>
                      </div>
                      <div className="relative h-1.5 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <div
                          style={{
                            position: 'absolute', left: 0, top: 0, bottom: 0,
                            width: `${sharePct}%`,
                            background: r.color,
                            opacity: 0.8,
                          }}
                          aria-label={`${sharePct.toFixed(1)}% del consumo team`}
                        />
                      </div>
                      <div className="flex items-baseline gap-3 text-[10px] font-mono whitespace-nowrap">
                        <span className="text-[var(--color-bright)] font-semibold tabular-nums">
                          {r.kt < 1000 ? `${r.kt.toFixed(1)} kT` : `${(r.kt / 1000).toFixed(2)} MT`}
                        </span>
                        <span className="text-[var(--color-muted)] tabular-nums" title="media kT/min nella finestra">
                          {r.avgRate.toFixed(2)}/min
                        </span>
                        <span className="text-[var(--color-dim)] tabular-nums w-10 text-right">
                          {sharePct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
