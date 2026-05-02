'use client'

// AgentActivityChart — vista combinata "rate token + eventi throttle".
// Carica entrambe le API:
//   /api/tokens/by-agent  → linee rate per agente (kT/min) — top 70%
//   /api/tokens/throttle  → rettangoli throttle (lane-assigned) — bottom 30%
// Asse X temporale condiviso. Stesso colore per stesso agente in entrambe
// le bande, così la correlazione "consumo dominante → throttle ordinato"
// si legge a colpo d'occhio.

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
            Linee = kT/min per agente · Barre in basso = pause throttle (start→durata).
            Stessi colori per agente: vedi se i picchi di rate coincidono con throttle ordinati.
          </p>
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

      {loading && !tokens && (
        <div className="h-[360px] flex items-center justify-center text-[11px] text-[var(--color-dim)]">loading…</div>
      )}
      {error && !tokens && (
        <div className="h-[360px] flex items-center justify-center text-[11px] text-[var(--color-warn,#f87171)]">{error}</div>
      )}
      {tokens && throttle && <Chart tokens={tokens} throttle={throttle} />}
    </div>
  )
}

type Bar = { x: number; y: number; w: number; h: number; color: string; agent: string; sec: number; tsStart: string; tsEnd: string; interrupted: boolean; orphan: boolean }

function Chart({ tokens, throttle }: { tokens: TokensPayload; throttle: ThrottlePayload }) {
  const W = 900
  const H = 380
  const PAD = { top: 16, right: 24, bottom: 28, left: 64 }
  const GAP = 14            // gap tra banda rate e banda throttle
  const RATIO_RATE = 0.7    // 70% top per linee rate
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const rateH = (innerH - GAP) * RATIO_RATE
  const throttleH = (innerH - GAP) * (1 - RATIO_RATE)
  const rateTop = PAD.top
  const rateBot = rateTop + rateH
  const throttleTop = rateBot + GAP
  const throttleBot = throttleTop + throttleH

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
  const yAtRate = (v: number) => rateTop + rateH - (v / rateMax) * rateH

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

  // === BANDA THROTTLE (bottom): rettangoli larghezza fissa, lane assignment ===
  const throttleMaxSec = useMemo(() => {
    let m = 0
    for (const iv of throttle.intervals) if (isVisible(iv.agent) && iv.sec > m) m = iv.sec
    return m > 0 ? m * 1.1 : 60
  }, [throttle.intervals, hidden]) // eslint-disable-line react-hooks/exhaustive-deps
  const yAtThrottle = (sec: number) => throttleBot - (sec / throttleMaxSec) * throttleH

  const BAR_W = 6
  const bars = useMemo<Bar[]>(() => {
    const sorted = [...throttle.intervals]
      .filter(iv => isVisible(iv.agent))
      .sort((a, b) => new Date(a.ts_start).getTime() - new Date(b.ts_start).getTime())
    const lanes: number[] = []
    const out: Bar[] = []
    for (const iv of sorted) {
      const startMs = new Date(iv.ts_start).getTime()
      const endMs = new Date(iv.ts_end).getTime()
      let lane = lanes.findIndex(occ => occ <= startMs)
      if (lane < 0) { lane = lanes.length; lanes.push(endMs) }
      else lanes[lane] = endMs
      const xs = xAtTime(startMs)
      const y = yAtThrottle(iv.sec)
      const h = throttleBot - y
      out.push({
        x: xs + lane * BAR_W,
        y,
        w: BAR_W - 1,
        h,
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
  }, [throttle.intervals, sinceMs, spanMs, throttleMaxSec, hidden]) // eslint-disable-line react-hooks/exhaustive-deps

  // Y ticks rate (sx) + throttle (dx, asse secondario)
  const rateTicks = useMemo(() => Array.from({ length: 4 }, (_, i) => {
    const v = (rateMax * (i + 1)) / 4
    return { v, y: yAtRate(v) }
  }), [rateMax]) // eslint-disable-line react-hooks/exhaustive-deps

  const throttleTicks = useMemo(() => [
    { v: throttleMaxSec, y: yAtThrottle(throttleMaxSec) },
    { v: throttleMaxSec / 2, y: yAtThrottle(throttleMaxSec / 2) },
  ], [throttleMaxSec]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Quale banda? Se il cursore è nella banda throttle cerca la barra più vicina
    if (yViewBox >= throttleTop - 4) {
      let best: Bar | null = null
      let bestDx = Infinity
      for (const b of bars) {
        const cx = b.x + b.w / 2
        const dx = Math.abs(xViewBox - cx)
        if (dx < bestDx) { bestDx = dx; best = b }
      }
      setHoverBar(bestDx <= 12 ? best : null)
      setHoverIdx(null)
    } else {
      const ratio = (xViewBox - PAD.left) / innerW
      const idx = Math.round(ratio * (n - 1))
      setHoverIdx(Math.max(0, Math.min(n - 1, idx)))
      setHoverBar(null)
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
        {/* sfondo banda throttle (sottile evidenziazione) */}
        <rect x={PAD.left} y={throttleTop} width={innerW} height={throttleH}
              fill="rgba(255,255,255,0.015)" stroke="var(--color-border)" strokeOpacity={0.3} />
        {/* griglia rate (sx) */}
        {rateTicks.map((t, i) => (
          <g key={`r${i}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y}
                  stroke="var(--color-border)" strokeDasharray="3 4" opacity={0.4} />
            <text x={PAD.left - 8} y={t.y + 3} fontSize={10}
                  fill="var(--color-dim)" textAnchor="end">
              {t.v.toFixed(t.v >= 100 ? 0 : t.v >= 10 ? 1 : 2)} kT/min
            </text>
          </g>
        ))}
        {/* tick scala throttle (sx, sotto la banda) */}
        {throttleTicks.map((t, i) => (
          <text key={`t${i}`} x={PAD.left - 8} y={t.y + 3} fontSize={10}
                fill="var(--color-dim)" textAnchor="end" opacity={0.7}>
            {formatSec(t.v)}
          </text>
        ))}
        {/* asse X labels */}
        {xTicks.map((t, i) => (
          <text key={`x${i}`} x={t.x} y={H - PAD.bottom + 14}
                fontSize={10} fill="var(--color-dim)" textAnchor="middle">
            {t.label}
          </text>
        ))}
        {/* linee rate */}
        {ratePaths.map(p => (
          <path key={p.agent} d={p.d} stroke={p.color} strokeWidth={1.6}
                fill="none" opacity={0.92} style={{ pointerEvents: 'none' }} />
        ))}
        {/* barre throttle */}
        {bars.map((b, i) => {
          const active = hoverBar === b
          const muted = b.interrupted || b.orphan
          return (
            <rect key={`${b.agent}-${i}`}
                  x={b.x} y={b.y} width={b.w} height={b.h}
                  fill={b.color}
                  opacity={active ? 1 : muted ? 0.4 : 0.85}
                  stroke={active ? '#fff' : muted ? b.color : 'none'}
                  strokeWidth={active ? 1 : muted ? 1 : 0}
                  strokeDasharray={muted && !active ? '2 2' : undefined}
                  rx={0.5}
                  style={{ pointerEvents: 'none' }} />
          )
        })}
        {/* crosshair (banda rate) */}
        {hoverIdx !== null && (
          <line x1={xAtIdx(hoverIdx)} x2={xAtIdx(hoverIdx)}
                y1={rateTop} y2={H - PAD.bottom}
                stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
        )}
        {/* marker hover linee */}
        {hoverIdx !== null && tokens.agents.filter(isVisible).map(a => {
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
