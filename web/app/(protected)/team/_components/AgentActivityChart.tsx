'use client'

// AgentActivityChart — vista combinata "rate token + eventi throttle".
// Carica entrambe le API:
//   /api/tokens/by-agent  → linee rate per agente (kT/min)
//   /api/tokens/throttle  → barre orizzontali throttle (start→end, lane-stack)
// Layout unico: barre e linee condividono la stessa area; le pause throttle
// sono rettangoli orizzontali la cui lunghezza = durata reale sull'asse X.
// Toggle "tutto / solo rate / solo pause" per togliere visivamente una delle
// due serie. Stesso colore per stesso agente, così "picco di rate ↔ pausa
// throttle conseguente" si legge a colpo d'occhio nello stesso spazio.

import { useEffect, useMemo, useRef, useState } from 'react'
import { colorForAgent as colorFor } from './agent-colors'

type Series = Record<string, number | string>

type TokensPayload = {
  ok: boolean
  now: string
  since: string
  bucket_sec: number
  agents: string[]
  totals_kt: Record<string, number>
  events: Record<string, number>
  series: Series[]
}

type Interval = {
  agent: string
  ts_start: string
  ts_end: string
  sec: number
  interrupted?: boolean
  orphan?: boolean
}

type ThrottlePayload = {
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

function formatSec(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`
  if (s < 3600) return `${(s / 60).toFixed(s < 600 ? 1 : 0)}m`
  return `${(s / 3600).toFixed(1)}h`
}

export default function AgentActivityChart() {
  const [tokens, setTokens] = useState<TokensPayload | null>(null)
  const [throttle, setThrottle] = useState<ThrottlePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<RangeId>('30m')
  // view: quali serie disegnare. 'both' = linee + barre sovrapposte,
  // 'rate' = solo linee, 'throttle' = solo barre. Disattivare entrambe non
  // ha senso → tre stati esclusivi (radio) invece di due booleani.
  const [view, setView] = useState<'rate' | 'throttle' | 'both'>('both')

  const fetchAll = (minutes: number, signal?: AbortSignal) => {
    const bucketSec = Math.max(1, Math.round((minutes * 60) / 120))
    const qs = `sinceMin=${minutes}&bucketSec=${bucketSec}`
    return Promise.all([
      fetch(`/api/tokens/by-agent?${qs}`, { cache: 'no-store', signal }).then(r => r.json() as Promise<TokensPayload>),
      fetch(`/api/tokens/throttle?${qs}`, { cache: 'no-store', signal }).then(r => r.json() as Promise<ThrottlePayload>),
    ])
  }

  useEffect(() => {
    const ac = new AbortController()
    const minutes = RANGES.find(r => r.id === range)?.minutes ?? 30
    setLoading(true)
    setError(null)
    fetchAll(minutes, ac.signal)
      .then(([t, th]) => {
        if (!t.ok || !th.ok) { setError('Risposta non valida'); return }
        setTokens(t); setThrottle(th)
      })
      .catch(e => {
        if (ac.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [range])

  // Polling 30s
  useEffect(() => {
    const id = setInterval(() => {
      const minutes = RANGES.find(r => r.id === range)?.minutes ?? 30
      fetchAll(minutes)
        .then(([t, th]) => { if (t.ok) setTokens(t); if (th.ok) setThrottle(th) })
        .catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [range])

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-bright)]">
            Attività agenti — rate consumo + throttle
          </h2>
          <p className="text-[10px] text-[var(--color-dim)] mt-0.5">
            Linee = kT/min per agente · Barre orizzontali = pause throttle (start↔end).
            Stessi colori per agente: la barra cade esattamente nel tempo in cui l&apos;agente era in pausa.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Toggle vista: rate / throttle / entrambi */}
          <div className="flex">
            {([
              { id: 'both' as const,     label: 'tutto' },
              { id: 'rate' as const,     label: 'solo rate' },
              { id: 'throttle' as const, label: 'solo pause' },
            ]).map((opt, i, arr) => {
              const active = view === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => setView(opt.id)}
                  className="px-2.5 py-1 text-[10px] font-medium transition-colors"
                  style={{
                    background: active ? 'rgba(34,211,238,0.15)' : 'transparent',
                    color: active ? '#22d3ee' : 'var(--color-dim)',
                    border: `1px solid ${active ? 'rgba(34,211,238,0.35)' : 'var(--color-border)'}`,
                    borderLeftWidth: i > 0 ? 0 : 1,
                    borderTopLeftRadius: i === 0 ? 4 : 0,
                    borderBottomLeftRadius: i === 0 ? 4 : 0,
                    borderTopRightRadius: i === arr.length - 1 ? 4 : 0,
                    borderBottomRightRadius: i === arr.length - 1 ? 4 : 0,
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          <div className="flex gap-1 flex-wrap">
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
      </div>

      {loading && !tokens && (
        <div className="h-[360px] flex items-center justify-center text-[11px] text-[var(--color-dim)]">loading…</div>
      )}
      {error && !tokens && (
        <div className="h-[360px] flex items-center justify-center text-[11px] text-[var(--color-warn,#f87171)]">{error}</div>
      )}
      {tokens && throttle && <Chart tokens={tokens} throttle={throttle} view={view} />}
    </div>
  )
}

type Bar = { x: number; y: number; w: number; h: number; color: string; agent: string; sec: number; tsStart: string; tsEnd: string; interrupted: boolean; orphan: boolean }

function Chart({
  tokens, throttle, view,
}: {
  tokens: TokensPayload; throttle: ThrottlePayload;
  view: 'rate' | 'throttle' | 'both';
}) {
  const showRate = view === 'rate' || view === 'both'
  const showThrottle = view === 'throttle' || view === 'both'

  const W = 900
  const H = 380
  const PAD = { top: 16, right: 24, bottom: 28, left: 64 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  // Layout unico: niente più bande separate. Le linee rate occupano tutto
  // l'altezza utile; le barre throttle sono rettangoli orizzontali in
  // overlay, lane-stacked dal basso così non oscurano le linee in alto.
  const chartTop = PAD.top
  const chartBot = PAD.top + innerH
  const chartH = innerH

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hoverPos, setHoverPos] = useState<{ xPct: number; yPct: number } | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [hoverBar, setHoverBar] = useState<Bar | null>(null)
  // Agenti nascosti dall'utente: click sulla card legenda toggla.
  // Usato per filtrare sia linee rate che barre throttle, e per ricalcolare
  // rateMax/throttleMaxSec così l'asse Y si auto-scala su quelli visibili.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const isVisible = (a: string) => !hidden.has(a)
  const toggleAgent = (a: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(a)) next.delete(a); else next.add(a)
      return next
    })
  }

  // Range tempo: usiamo since/now di tokens (le 2 API rispondono nello stesso
  // istante con stessa finestra, scarti microsecondi trascurabili).
  const sinceMs = useMemo(() => new Date(tokens.since).getTime(), [tokens.since])
  const nowMs = useMemo(() => new Date(tokens.now).getTime(), [tokens.now])
  const spanMs = Math.max(1, nowMs - sinceMs)
  const xAtTime = (tsMs: number) => PAD.left + ((tsMs - sinceMs) / spanMs) * innerW

  // === BANDA RATE (top): linee kT/min per agente ===
  // Calcolo delta cumulative bucket-to-bucket → kT/min.
  const rateDisplay = useMemo(() => {
    const factor = 60 / Math.max(1, tokens.bucket_sec)
    const rows: Record<string, number>[] = []
    for (let i = 0; i < tokens.series.length; i++) {
      const out: Record<string, number> = {}
      for (const a of tokens.agents) {
        const cur = tokens.series[i][a]
        const prev = i > 0 ? tokens.series[i - 1][a] : cur
        const dCur = typeof cur === 'number' ? cur : 0
        const dPrev = typeof prev === 'number' ? prev : 0
        out[a] = Math.max(0, dCur - dPrev) * factor
      }
      rows.push(out)
    }
    return rows
  }, [tokens])

  const rateMax = useMemo(() => {
    let m = 0
    for (const row of rateDisplay) for (const a of tokens.agents) {
      if (!isVisible(a)) continue
      const v = row[a]
      if (typeof v === 'number' && v > m) m = v
    }
    return m > 0 ? m * 1.1 : 1
  }, [rateDisplay, tokens.agents, hidden]) // eslint-disable-line react-hooks/exhaustive-deps

  const n = tokens.series.length
  const xAtIdx = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yAtRate = (v: number) => chartTop + chartH - (v / rateMax) * chartH

  const ratePaths = useMemo(() => {
    return tokens.agents.filter(isVisible).map(agent => {
      const pts: string[] = []
      for (let i = 0; i < rateDisplay.length; i++) {
        const v = rateDisplay[i][agent] ?? 0
        const y = yAtRate(v)
        const x = xAtIdx(i)
        pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
      }
      return { agent, d: pts.join(' '), color: colorFor(agent) }
    })
  }, [rateDisplay, tokens.agents, rateMax, hidden]) // eslint-disable-line react-hooks/exhaustive-deps

  // === BARRE THROTTLE (overlay orizzontale): rettangoli posizionati sull'asse
  // X esattamente dove cade la pausa (start→end). Lane-stack dal basso
  // verso l'alto: se due pause si sovrappongono temporalmente vanno su lane
  // diverse impilate. La durata è larghezza in pixel (xAtTime(end) - xAtTime(start)),
  // NON è più altezza Y — niente più asse secondario per i secondi. ===
  const BAR_H = 7
  const LANE_GAP = 1
  const bars = useMemo<Bar[]>(() => {
    const sorted = [...throttle.intervals]
      .filter(iv => isVisible(iv.agent))
      .sort((a, b) => new Date(a.ts_start).getTime() - new Date(b.ts_start).getTime())
    const lanes: number[] = []  // ts_end_ms occupato per ogni lane
    const out: Bar[] = []
    for (const iv of sorted) {
      const startMs = new Date(iv.ts_start).getTime()
      const endMs = new Date(iv.ts_end).getTime()
      let lane = lanes.findIndex(occ => occ <= startMs)
      if (lane < 0) { lane = lanes.length; lanes.push(endMs) }
      else lanes[lane] = endMs
      const xs = xAtTime(startMs)
      const xe = xAtTime(endMs)
      // Larghezza minima 2px per render visibile delle pause brevissime.
      const w = Math.max(2, xe - xs)
      // Lane 0 è il fondo del chart, lane crescenti vanno verso l'alto.
      const y = chartBot - (lane + 1) * BAR_H - lane * LANE_GAP
      out.push({
        x: xs,
        y,
        w,
        h: BAR_H,
        color: colorFor(iv.agent),
        agent: iv.agent,
        sec: iv.sec,
        tsStart: iv.ts_start,
        tsEnd: iv.ts_end,
        interrupted: !!iv.interrupted,
        orphan: !!iv.orphan,
      })
    }
    return out
  }, [throttle.intervals, sinceMs, spanMs, hidden]) // eslint-disable-line react-hooks/exhaustive-deps

  // Y ticks rate (sx) — un solo asse Y ora, niente più secondario.
  const rateTicks = useMemo(() => Array.from({ length: 4 }, (_, i) => {
    const v = (rateMax * (i + 1)) / 4
    return { v, y: yAtRate(v) }
  }), [rateMax]) // eslint-disable-line react-hooks/exhaustive-deps

  const xTicks = useMemo(() => {
    if (n === 0) return []
    const ticks = []
    const k = Math.min(5, n)
    for (let i = 0; i < k; i++) {
      const idx = Math.round((i / (k - 1)) * (n - 1))
      const ts = tokens.series[idx]?.ts as string | undefined
      const label = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
      ticks.push({ x: xAtIdx(idx), label })
    }
    return ticks
  }, [tokens, n]) // eslint-disable-line react-hooks/exhaustive-deps

  // === Hover ===
  // Le barre throttle sono ora overlay orizzontali in fondo all'area chart;
  // hit-test rettangolare ha precedenza sulle linee (così cliccando una pausa
  // si vede subito il suo dettaglio anche se sopra c'è una linea rate).
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const xPx = e.clientX - rect.left
    const yPx = e.clientY - rect.top
    const xViewBox = (xPx / rect.width) * W
    const yViewBox = (yPx / rect.height) * H
    if (xViewBox < PAD.left || xViewBox > W - PAD.right) {
      setHoverIdx(null); setHoverBar(null); setHoverPos(null); return
    }
    // 1) Hit-test esatto sulle barre throttle (rect contains)
    let hitBar: Bar | null = null
    if (showThrottle) {
      for (const b of bars) {
        if (xViewBox >= b.x && xViewBox <= b.x + b.w &&
            yViewBox >= b.y - 1 && yViewBox <= b.y + b.h + 1) {
          hitBar = b
          break
        }
      }
    }
    if (hitBar) {
      setHoverBar(hitBar)
      setHoverIdx(null)
    } else if (showRate) {
      const ratio = (xViewBox - PAD.left) / innerW
      const idx = Math.round(ratio * (n - 1))
      setHoverIdx(Math.max(0, Math.min(n - 1, idx)))
      setHoverBar(null)
    } else {
      setHoverBar(null); setHoverIdx(null)
    }
    setHoverPos({ xPct: (xPx / rect.width) * 100, yPct: (yPx / rect.height) * 100 })
  }
  const handleLeave = () => { setHoverIdx(null); setHoverBar(null); setHoverPos(null) }

  const hoverRow = hoverIdx !== null ? rateDisplay[hoverIdx] : null
  const hoverTs = hoverIdx !== null ? (tokens.series[hoverIdx]?.ts as string | undefined) : undefined
  const hoverActive = hoverRow
    ? tokens.agents
        .filter(isVisible)
        .map(a => ({ agent: a, v: typeof hoverRow[a] === 'number' ? hoverRow[a] as number : 0 }))
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
        {/* griglia rate (sx) — visibile solo se le linee rate sono attive,
            altrimenti la griglia kT/min sarebbe rumore senza dati */}
        {showRate && rateTicks.map((t, i) => (
          <g key={`r${i}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y}
                  stroke="var(--color-border)" strokeDasharray="3 4" opacity={0.4} />
            <text x={PAD.left - 8} y={t.y + 3} fontSize={10}
                  fill="var(--color-dim)" textAnchor="end">
              {t.v.toFixed(t.v >= 100 ? 0 : t.v >= 10 ? 1 : 2)} kT/min
            </text>
          </g>
        ))}
        {/* asse X labels */}
        {xTicks.map((t, i) => (
          <text key={`x${i}`} x={t.x} y={H - PAD.bottom + 14}
                fontSize={10} fill="var(--color-dim)" textAnchor="middle">
            {t.label}
          </text>
        ))}
        {/* linee rate */}
        {showRate && ratePaths.map(p => (
          <path key={p.agent} d={p.d} stroke={p.color} strokeWidth={1.6}
                fill="none" opacity={0.92} style={{ pointerEvents: 'none' }} />
        ))}
        {/* barre throttle (rettangoli orizzontali, lane-stack dal basso) */}
        {showThrottle && bars.map((b, i) => {
          const active = hoverBar === b
          const muted = b.interrupted || b.orphan
          return (
            <rect key={`${b.agent}-${i}`}
                  x={b.x} y={b.y} width={b.w} height={b.h}
                  fill={b.color}
                  opacity={active ? 1 : muted ? 0.45 : 0.78}
                  stroke={active ? '#fff' : muted ? b.color : 'none'}
                  strokeWidth={active ? 1 : muted ? 1 : 0}
                  strokeDasharray={muted && !active ? '2 2' : undefined}
                  rx={1}
                  style={{ pointerEvents: 'none' }} />
          )
        })}
        {/* crosshair sull'intera area chart */}
        {hoverIdx !== null && showRate && (
          <line x1={xAtIdx(hoverIdx)} x2={xAtIdx(hoverIdx)}
                y1={chartTop} y2={chartBot}
                stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        )}
        {/* marker hover linee */}
        {hoverIdx !== null && showRate && tokens.agents.filter(isVisible).map(a => {
          const v = hoverRow?.[a]
          if (typeof v !== 'number' || v <= 0) return null
          return (
            <circle key={a} cx={xAtIdx(hoverIdx)} cy={yAtRate(v)} r={3.2}
                    fill={colorFor(a)} stroke="#0a0a0a" strokeWidth={1} />
          )
        })}
      </svg>

      {/* Tooltip rate */}
      {hoverPos && hoverActive.length > 0 && hoverTs && (
        <div className="pointer-events-none absolute z-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 shadow-lg"
             style={{
               left: hoverPos.xPct > 55 ? undefined : `calc(${hoverPos.xPct}% + 12px)`,
               right: hoverPos.xPct > 55 ? `calc(${100 - hoverPos.xPct}% + 12px)` : undefined,
               top: hoverPos.yPct > 50 ? '8px' : undefined,
               bottom: hoverPos.yPct > 50 ? undefined : '8px',
               minWidth: 200,
             }}>
          <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
            {new Date(hoverTs).toLocaleTimeString()}<span className="ml-1 opacity-60">· rate</span>
          </div>
          <div className="mt-1.5 grid gap-1 text-[11px] font-mono">
            {hoverActive.map(({ agent, v }) => (
              <div key={agent} className="flex items-center gap-2">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(agent), flexShrink: 0 }} />
                <span className="text-[var(--color-bright)]">{agent}</span>
                <span className="ml-auto text-[var(--color-muted)]">
                  {`${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} kT/min`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tooltip throttle */}
      {hoverPos && hoverBar && (
        <div className="pointer-events-none absolute z-10 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 shadow-lg"
             style={{
               left: hoverPos.xPct > 55 ? undefined : `calc(${hoverPos.xPct}% + 12px)`,
               right: hoverPos.xPct > 55 ? `calc(${100 - hoverPos.xPct}% + 12px)` : undefined,
               top: hoverPos.yPct > 50 ? '8px' : undefined,
               bottom: hoverPos.yPct > 50 ? undefined : '8px',
               minWidth: 200,
             }}>
          <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
            evento · {formatSec(hoverBar.sec)}
            {(hoverBar.interrupted || hoverBar.orphan) && (
              <span className="ml-1 opacity-70">· {hoverBar.orphan ? 'orfano' : 'interrotto'}</span>
            )}
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

      {/* Legenda interattiva — click per toggle visibilità */}
      <div className="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 text-[10px]">
        {Array.from(new Set([...tokens.agents, ...throttle.agents])).map(a => {
          const totalKt = tokens.totals_kt[a] ?? 0
          const totalSec = throttle.totals_sec[a] ?? 0
          const visible = isVisible(a)
          return (
            <button
              key={a}
              type="button"
              onClick={() => toggleAgent(a)}
              title={visible ? `Click per nascondere ${a}` : `Click per mostrare ${a}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-left transition-opacity"
              style={{
                background: 'var(--color-surface, rgba(255,255,255,0.02))',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
                opacity: visible ? 1 : 0.4,
              }}
            >
              <span style={{
                width: 10, height: 10, borderRadius: 2,
                background: visible ? colorFor(a) : 'transparent',
                border: visible ? 'none' : `1.5px solid ${colorFor(a)}`,
                flexShrink: 0,
              }} />
              <span className="font-mono text-[var(--color-bright)] truncate" style={{ textDecoration: visible ? 'none' : 'line-through' }}>{a}</span>
              <span className="ml-auto text-[var(--color-dim)] tabular-nums">
                {totalKt.toFixed(1)} kT
                {totalSec > 0 && <span className="ml-1 opacity-60">· {formatSec(totalSec)}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
