'use client'

// ThrottleChart — pause di throttle applicate dagli agenti nel tempo.
// Dato sorgente: /api/tokens/throttle (alimentato dallo script python
// shared/skills/throttle-series.py che legge throttle-events.jsonl
// scritto dalla skill `throttle.py`).
//
// Mostra "secondi di pausa cumulativi per agente" (curva crescente). Tile
// sotto AgentTokensChart: insieme raccontano "chi consuma" e "chi rallenta"
// — input per la calibrazione che il Capitano fa nel tempo.

import { useEffect, useMemo, useRef, useState } from 'react'
import { colorForAgent as colorFor } from './agent-colors'

type Series = Record<string, number | string>

type Interval = {
  agent: string
  ts_start: string
  ts_end: string
  sec: number
}

type Payload = {
  ok: boolean
  now: string
  since: string
  bucket_sec: number
  agents: string[]
  totals_sec: Record<string, number>
  events: Record<string, number>
  series: Series[]
  intervals: Interval[]
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

function formatSec(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`
  if (s < 3600) return `${(s / 60).toFixed(s < 600 ? 1 : 0)}m`
  return `${(s / 3600).toFixed(1)}h`
}

export default function ThrottleChart() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeId>('3h')
  const [mode, setMode] = useState<Mode>('cumulative')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const minutes = RANGES.find(r => r.id === range)?.minutes ?? 180
    const bucketSec = Math.max(1, Math.round((minutes * 60) / 120))

    setLoading(true)
    setError(null)
    fetch(`/api/tokens/throttle?sinceMin=${minutes}&bucketSec=${bucketSec}`, { cache: 'no-store' })
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

  useEffect(() => {
    const id = setInterval(() => {
      const minutes = RANGES.find(r => r.id === range)?.minutes ?? 180
      const bucketSec = Math.max(1, Math.round((minutes * 60) / 120))
      fetch(`/api/tokens/throttle?sinceMin=${minutes}&bucketSec=${bucketSec}`, { cache: 'no-store' })
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
            Throttle per agente
          </h2>
          <p className="text-[10px] text-[var(--color-dim)] mt-0.5">
            {mode === 'cumulative'
              ? 'Secondi di pausa cumulativi (skill `throttle`). Aggiornamento ogni 30s.'
              : 'Eventi throttle nel tempo: altezza = secondi richiesti, picco = momento della chiamata.'}
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

      <div className="mb-3 flex gap-1">
        {([
          { id: 'cumulative', label: 'Cumulativo' },
          { id: 'rate', label: 'Eventi' },
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
      {data && (
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
  const PAD = { top: 16, right: 24, bottom: 28, left: 64 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const svgRef = useRef<SVGSVGElement | null>(null)
  // posizione del cursor in % sopra il wrapper, per il tooltip floating
  // (stesso pattern di UsageChart). xPct/yPct riferiti al frame del chart.
  const [hoverPos, setHoverPos] = useState<{ xPct: number; yPct: number } | null>(null)

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
    // eventi: delta cumulativo per bucket, NON normalizzato a /min.
    // Mostra "secondi di throttle registrati nel bucket" — un picco = una
    // chiamata jht-throttle (l'altezza è il valore di --seconds richiesto).
    // Più chiamate nello stesso bucket si sommano.
    const rows: Record<string, number>[] = []
    for (let i = 0; i < data.series.length; i++) {
      const out: Record<string, number> = {}
      for (const a of data.agents) {
        const cur = data.series[i][a]
        const prev = i > 0 ? data.series[i - 1][a] : cur
        const dCur = typeof cur === 'number' ? cur : 0
        const dPrev = typeof prev === 'number' ? prev : 0
        out[a] = Math.max(0, dCur - dPrev)
      }
      rows.push(out)
    }
    return rows
  }, [data, mode])

  const yMax = useMemo(() => {
    let m = 0
    if (mode === 'rate') {
      // In modalità Eventi non usiamo i bucket: l'asse Y è la durata
      // della singola pausa (`sec`), non un'aggregazione bucket.
      for (const iv of data.intervals) if (iv.sec > m) m = iv.sec
    } else {
      for (const row of display) {
        for (const a of data.agents) {
          const v = row[a]
          if (typeof v === 'number' && v > m) m = v
        }
      }
    }
    // Fallback: scala "leggibile" anche quando non c'è nessun evento.
    // 60s sia in cumulativo che eventi (ordine di grandezza tipico di un
    // singolo throttle).
    if (m <= 0) return 60
    return m * 1.1
  }, [display, data.agents, data.intervals, mode])

  const n = data.series.length
  const xAt = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yAt = (v: number) => PAD.top + innerH - (v / yMax) * innerH

  // Mapping diretto timestamp→x basato sul range [since, now] del payload.
  // Usato in modalità Eventi per posizionare i rettangoli al ts esatto,
  // bypassando il bucketing della serie cumulativa.
  const sinceMs = useMemo(() => new Date(data.since).getTime(), [data.since])
  const nowMs = useMemo(() => new Date(data.now).getTime(), [data.now])
  const spanMs = Math.max(1, nowMs - sinceMs)
  const xAtTime = (tsMs: number) =>
    PAD.left + ((tsMs - sinceMs) / spanMs) * innerW

  // Path lineari (modo cumulativo): curva crescente, una linea per agente.
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

  // Modalità Eventi: una barra per pausa completata, posizionata al
  // ts_start con LARGHEZZA FISSA (l'altezza già rappresenta la durata —
  // mantenere proporzionalità anche in larghezza schiaccia visivamente
  // gli eventi brevi quando ce n'è uno lungo nello stesso range).
  //
  // Lane assignment per evitare sovrapposizioni: scorro gli eventi in
  // ordine di ts_start e assegno ciascuno alla prima lane libera
  // (lane = colonna laterale). Più eventi che condividono lo stesso
  // intervallo temporale vengono affiancati invece di coprirsi.
  const BAR_W = 6
  type Bar = { x: number; y: number; w: number; h: number; color: string; agent: string; v: number; tsStart: string; tsEnd: string }
  const bars = useMemo<Bar[]>(() => {
    if (mode !== 'rate') return []
    // ordinati per ts_start dal backend, ma riassicuriamoci
    const sorted = [...data.intervals].sort(
      (a, b) => new Date(a.ts_start).getTime() - new Date(b.ts_start).getTime(),
    )
    const lanes: number[] = [] // lanes[i] = ts_end (ms) dell'ultimo evento in lane i
    const out: Bar[] = []
    for (const iv of sorted) {
      const startMs = new Date(iv.ts_start).getTime()
      const endMs = new Date(iv.ts_end).getTime()
      // prima lane libera (ts_end ≤ startMs)
      let lane = lanes.findIndex(occ => occ <= startMs)
      if (lane < 0) {
        lane = lanes.length
        lanes.push(endMs)
      } else {
        lanes[lane] = endMs
      }
      const xs = xAtTime(startMs)
      const y = yAt(iv.sec)
      const h = yAt(0) - y
      out.push({
        x: xs + lane * BAR_W,
        y,
        w: BAR_W - 1, // 1px gap fra lanes affiancate
        h,
        color: colorFor(iv.agent),
        agent: iv.agent,
        v: iv.sec,
        tsStart: iv.ts_start,
        tsEnd: iv.ts_end,
      })
    }
    return out
  }, [data.intervals, mode, sinceMs, spanMs, yMax]) // eslint-disable-line react-hooks/exhaustive-deps

  const yTicks = useMemo(() => {
    const ticks = []
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4
      ticks.push({ v, y: yAt(v) })
    }
    return ticks
  }, [yMax]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // In modalità Eventi cerchiamo la barra più vicina al cursore
  // (entro un raggio in viewBox-px) — niente bucketing, ogni barra è
  // un evento individuale. In Cumulativo torniamo al bucket idx classico.
  const [hoverBar, setHoverBar] = useState<Bar | null>(null)

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const xPx = e.clientX - rect.left
    const yPx = e.clientY - rect.top
    const xViewBox = (xPx / rect.width) * W
    if (xViewBox < PAD.left || xViewBox > W - PAD.right) {
      onHover(null)
      setHoverBar(null)
      setHoverPos(null)
      return
    }
    if (mode === 'rate') {
      // barra più vicina (centro X) entro 12 viewBox-px. Se due barre sono
      // affiancate in lane, l'utente seleziona quella sotto al cursore.
      let best: Bar | null = null
      let bestDx = Infinity
      for (const b of bars) {
        const cx = b.x + b.w / 2
        const dx = Math.abs(xViewBox - cx)
        if (dx < bestDx) { bestDx = dx; best = b }
      }
      setHoverBar(bestDx <= 12 ? best : null)
      onHover(null)
    } else {
      const ratio = (xViewBox - PAD.left) / innerW
      const idx = Math.round(ratio * (n - 1))
      onHover(Math.max(0, Math.min(n - 1, idx)))
      setHoverBar(null)
    }
    setHoverPos({
      xPct: (xPx / rect.width) * 100,
      yPct: (yPx / rect.height) * 100,
    })
  }

  const handleLeave = () => {
    onHover(null)
    setHoverBar(null)
    setHoverPos(null)
  }

  const hoverRow = hoverIdx !== null ? display[hoverIdx] : null
  const hoverTs = hoverIdx !== null ? (data.series[hoverIdx]?.ts as string | undefined) : undefined
  // agenti con un valore > 0 nel bucket hover-ato, ordinati per valore desc.
  const hoverActive = hoverRow
    ? data.agents
        .map(a => ({ agent: a, v: typeof hoverRow[a] === 'number' ? (hoverRow[a] as number) : 0 }))
        .filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v)
    : []

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
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={t.y} y2={t.y}
              stroke="var(--color-border)" strokeDasharray="3 4" opacity={0.4}
            />
            <text x={PAD.left - 8} y={t.y + 3} fontSize={10}
                  fill="var(--color-dim)" textAnchor="end">
              {formatSec(t.v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - PAD.bottom + 14}
                fontSize={10} fill="var(--color-dim)" textAnchor="middle">
            {t.label}
          </text>
        ))}
        {/* Cumulativo: linee crescenti per agente. Eventi: barre verticali. */}
        {mode === 'cumulative' && paths.map(p => (
          <path key={p.agent} d={p.d} stroke={p.color} strokeWidth={1.8} fill="none" opacity={0.92} />
        ))}
        {mode === 'rate' && bars.map((b, i) => {
          const active = hoverBar === b
          return (
            <rect
              key={`${b.agent}-${i}`}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              fill={b.color}
              opacity={active ? 1 : 0.9}
              stroke={active ? '#fff' : 'none'}
              strokeWidth={active ? 1 : 0}
              rx={0.5}
              style={{ pointerEvents: 'none' }}
            />
          )
        })}
        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)} x2={xAt(hoverIdx)}
            y1={PAD.top} y2={H - PAD.bottom}
            stroke="rgba(255,255,255,0.25)" strokeWidth={1}
          />
        )}
        {/* Marker pallini hover: solo per la modalità cumulativo. In eventi
            le barre stesse sono i marker. */}
        {mode === 'cumulative' && hoverIdx !== null && data.agents.map(a => {
          const v = hoverRow?.[a]
          if (typeof v !== 'number') return null
          return (
            <circle key={a} cx={xAt(hoverIdx)} cy={yAt(v)} r={3.2}
                    fill={colorFor(a)} stroke="#0a0a0a" strokeWidth={1} />
          )
        })}
      </svg>

      {/* Tooltip cumulativo: lista agenti del bucket hover-ato */}
      {mode === 'cumulative' && hoverPos && hoverActive.length > 0 && hoverTs && (
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
            <span className="ml-1 opacity-60">· cumulativo</span>
          </div>
          <div className="mt-1.5 grid gap-1 text-[11px] font-mono">
            {hoverActive.map(({ agent, v }) => (
              <div key={agent} className="flex items-center gap-2">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(agent), flexShrink: 0 }} />
                <span className="text-[var(--color-bright)]">{agent}</span>
                <span className="ml-auto text-[var(--color-muted)]">{formatSec(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tooltip eventi: dettaglio del singolo throttle hover-ato */}
      {mode === 'rate' && hoverPos && hoverBar && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 shadow-lg"
          style={{
            left: hoverPos.xPct > 55 ? undefined : `calc(${hoverPos.xPct}% + 12px)`,
            right: hoverPos.xPct > 55 ? `calc(${100 - hoverPos.xPct}% + 12px)` : undefined,
            top: hoverPos.yPct > 50 ? '8px' : undefined,
            bottom: hoverPos.yPct > 50 ? undefined : '8px',
            minWidth: 200,
          }}
        >
          <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
            evento · {formatSec(hoverBar.v)}
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: hoverBar.color, flexShrink: 0 }} />
            <span className="text-[var(--color-bright)]">{hoverBar.agent}</span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--color-dim)] font-mono">
            <div>start: {new Date(hoverBar.tsStart).toLocaleTimeString()}</div>
            <div>end:&nbsp;&nbsp; {new Date(hoverBar.tsEnd).toLocaleTimeString()}</div>
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 text-[10px]">
        {data.agents.map(a => {
          const total = data.totals_sec[a] ?? 0
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
                {hoverV !== null ? formatSec(hoverV) : formatSec(total)}
                <span className="ml-1 opacity-60">· {ev}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

