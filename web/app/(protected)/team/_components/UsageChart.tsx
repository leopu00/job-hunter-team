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
  source?: string  // 'bridge' | 'capitano' | 'sentinella-api' | 'sentinella-worker' | 'manual'
}

const STATUS_COLOR: Record<string, string> = {
  OK: '#4ade80',
  SOTTOUTILIZZO: '#60a5fa',
  ATTENZIONE: '#facc15',
  CRITICO: '#f87171',
  RESET: '#a78bfa',
  ANOMALIA: '#fb923c',
}

// Palette per chi ha generato il sample (arch nuova 2026-04-25).
// Permette di vedere a colpo d'occhio chi ha fatto il check.
const SOURCE_COLOR: Record<string, string> = {
  bridge:              '#22d3ee',  // cyan — orologio automatico
  capitano:            '#22c55e',  // verde — check on-demand del Capitano
  'sentinella-api':    '#a855f7',  // viola — Sentinella ramo API
  'sentinella-worker': '#facc15',  // giallo — Sentinella fallback TUI manuale
  manual:              '#94a3b8',  // grigio — debug
}

const RANGES = [
  { id: '10m', label: '10m', minutes: 10 },
  { id: '30m', label: '30m', minutes: 30 },
  { id: '1h',  label: '1h',  minutes: 60 },
  { id: '6h',  label: '6h',  minutes: 6 * 60 },
  { id: '24h', label: '24h', minutes: 24 * 60 },
  { id: 'all', label: 'tutto', minutes: Infinity },
] as const
type RangeId = (typeof RANGES)[number]['id']

type HoverState = { index: number; xPct: number; yPct: number } | null

function Chart({
  entries, tMin, tMax, onHover, onPan,
}: {
  entries: Entry[]; tMin: number; tMax: number; onHover: (h: HoverState) => void;
  /** Chiamato durante drag con il delta in millisecondi (positivo = vai avanti
   *  nel tempo, negativo = vai indietro). Il parent applica al panRightTs. */
  onPan?: (deltaMs: number) => void;
}) {
  const W = 900
  const H = 360
  const PAD = { top: 36, right: 56, bottom: 32, left: 48 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const svgRef = useRef<SVGSVGElement | null>(null)

  // x-axis time-based: il grafico copre l'intervallo [tMin, tMax] che il
  // parent aggiorna al wall-clock. I sample si posizionano al loro ts reale,
  // non in posizione uniforme tra 0 e n — cosi' gap temporali si vedono e
  // l'asse scorre anche senza nuovi dati.
  const tSpan = Math.max(1, tMax - tMin)
  const xAt = useCallback(
    (ts: number) => PAD.left + ((ts - tMin) / tSpan) * innerW,
    [tMin, tSpan, innerW]
  )

  // yMax dinamico: scala la verticale in base al valore massimo visibile
  // (usage, projection, velocity_ideal). Minimo 100 così quando tutto è
  // sotto quota vediamo comunque la scala 0-100%. Se invece c'è una
  // projection a 132%, la scala cresce fino a ~150 (round-up a multiplo
  // di 10 + 10 di margine).
  const yMax = useMemo(() => {
    let m = 100
    for (const e of entries) {
      for (const v of [e.usage, e.projection, e.velocity_ideal] as (number | undefined | null)[]) {
        if (typeof v === 'number' && Number.isFinite(v) && v > m) m = v
      }
    }
    return Math.ceil(m / 10) * 10 + 10
  }, [entries])

  const yAt = useCallback(
    (v: number) => PAD.top + innerH - (Math.max(0, Math.min(yMax, v)) / yMax) * innerH,
    [innerH, yMax]
  )

  // Soglia di gap: se due sample adiacenti distano piu' di GAP_MS nel
  // tempo reale, interrompiamo il path (usa M invece di L). Cosi' quando
  // il bridge salta tick (API 429, restart, ecc.) vediamo un buco onesto
  // invece di una retta che interpola inesistente.
  // Gap tra sample oltre il quale la linea si spezza (per evitare di
  // interpolare un buco di osservazione come se fosse continuità).
  // Calibrazione: post-2026-04-25 il bridge tickka ogni 5 min e la
  // Sentinella scrive a ogni tick → gap fisiologico ~5 min. Alziamo a
  // 12 min (2.4x del tick) così la linea si connette regolarmente; se
  // c'è un vero blackout (>12 min senza sample) la linea si spezza
  // come segnale visivo.
  const GAP_MS = 12 * 60 * 1000

  const pathFor = (key: keyof Entry) => {
    const parts: string[] = []
    let prevTs: number | null = null
    entries.forEach((e) => {
      const v = e[key] as number | undefined
      if (v === undefined || v === null || Number.isNaN(v)) {
        prevTs = null
        return
      }
      const ts = new Date(e.ts).getTime()
      const isGap = prevTs !== null && (ts - prevTs) > GAP_MS
      const cmd = parts.length === 0 || isGap ? 'M' : 'L'
      parts.push(`${cmd} ${xAt(ts).toFixed(1)} ${yAt(v).toFixed(1)}`)
      prevTs = ts
    })
    return parts.join(' ')
  }

  const refLines = yMax > 110 ? [50, 80, 95, 100, yMax] : [50, 80, 95, 100]

  // Mouse → nearest sample (by time). Inverse di xAt (time-based):
  // pxX → vbX → ts → trova il sample col ts più vicino.
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || entries.length === 0) return
    const rect = svg.getBoundingClientRect()
    const pxX = e.clientX - rect.left
    const vbX = (pxX / rect.width) * W
    const rel = Math.max(0, Math.min(1, (vbX - PAD.left) / innerW))
    const targetTs = tMin + rel * tSpan
    let bestIdx = 0
    let bestDiff = Infinity
    entries.forEach((en, i) => {
      const ts = Date.parse(en.ts)
      if (!Number.isFinite(ts)) return
      const diff = Math.abs(ts - targetTs)
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
    })
    const bestTs = Date.parse(entries[bestIdx].ts)
    onHover({
      index: bestIdx,
      xPct: (xAt(bestTs) / W) * 100,
      yPct: (yAt(entries[bestIdx].usage) / H) * 100,
    })
  }

  // Drag-to-pan (pattern d3-zoom): tieni premuto e trascina orizzontalmente
  // per scorrere nel tempo. Convertiamo il Δpixel in Δtempo usando la stessa
  // proporzione dell'asse x (pxPerMs). Drag verso destra → vai indietro nel
  // tempo (deltaMs negativo). hover viene messo in pausa durante il drag così
  // il tooltip non sfarfalla.
  const dragRef = useRef<{ startX: number; startTime: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const onSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPan || entries.length === 0) return
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startTime: Date.now() }
    setIsDragging(true)
    onHover(null)
  }
  const onWindowMouseMove = (e: MouseEvent) => {
    const drag = dragRef.current
    const svg = svgRef.current
    if (!drag || !svg || !onPan) return
    const rect = svg.getBoundingClientRect()
    const pxPerMs = (rect.width * (innerW / W)) / tSpan
    const deltaPx = e.clientX - drag.startX
    const deltaMs = -deltaPx / pxPerMs   // drag dx → guarda nel passato
    onPan(deltaMs)
    drag.startX = e.clientX
  }
  const onWindowMouseUp = () => {
    dragRef.current = null
    setIsDragging(false)
  }
  useEffect(() => {
    if (!isDragging) return
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging])

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      onMouseMove={isDragging ? undefined : handleMove}
      onMouseLeave={() => { if (!isDragging) onHover(null) }}
      onMouseDown={onSvgMouseDown}
      style={{
        width: '100%',
        maxWidth: W,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-panel)',
        display: 'block',
        cursor: entries.length === 0
          ? 'default'
          : isDragging ? 'grabbing'
          : onPan ? 'grab'
          : 'crosshair',
        userSelect: 'none',
      }}
    >
      {/* Sweet spot: banda 90%-95% dove vogliamo stare (G-spot).
           Projection sotto 90 = sottouso (SPINGI), sopra 95 = alert RALLENTA. */}
      <rect
        x={PAD.left}
        y={yAt(95)}
        width={innerW}
        height={yAt(90) - yAt(95)}
        fill="#22c55e"
        opacity={0.08}
      />
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={yAt(95)} y2={yAt(95)}
        stroke="#22c55e" strokeWidth={0.8} strokeDasharray="2 3" opacity={0.45}
      />
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={yAt(90)} y2={yAt(90)}
        stroke="#22c55e" strokeWidth={0.8} strokeDasharray="2 3" opacity={0.45}
      />
      <text
        x={W - PAD.right + 5}
        y={yAt(92.5) + 3}
        fontSize={9}
        fill="rgba(34,197,94,0.75)"
        fontWeight="600"
      >
        target
      </text>

      {refLines.map(v => {
        const isQuota = v === 100
        const isTargetEdge = v === 95
        const highlighted = isQuota || isTargetEdge
        return (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yAt(v)}
              y2={yAt(v)}
              stroke={isQuota ? '#f87171' : isTargetEdge ? '#facc15' : 'rgba(255,255,255,0.08)'}
              strokeDasharray={highlighted ? '4 4' : '2 6'}
              strokeWidth={highlighted ? 1 : 0.5}
            />
            <text x={W - PAD.right + 5} y={yAt(v) + 4} fontSize={10} fill="rgba(255,255,255,0.5)">
              {v}%
            </text>
          </g>
        )
      })}

      <path d={pathFor('projection')} stroke="#a78bfa" strokeWidth={1.3} fill="none" strokeDasharray="5 4" opacity={0.7} />
      <path d={pathFor('velocity_ideal')} stroke="#64748b" strokeWidth={1} fill="none" opacity={0.5} />
      <path d={pathFor('usage')} stroke="#22d3ee" strokeWidth={2} fill="none" />

      {entries.map((e, i) => {
        const ts = Date.parse(e.ts)
        if (!Number.isFinite(ts)) return null
        // Colore per source (chi ha fatto il check). Backward compat: i
        // sample legacy senza source cadono su STATUS_COLOR.
        const src = e.source || ''
        const sourceColor = SOURCE_COLOR[src]
        const fill = sourceColor || STATUS_COLOR[e.status] || '#22d3ee'
        const r = (src === 'capitano' || src.startsWith('sentinella')) ? 3.5 : 2.6
        return (
          <circle
            key={i}
            cx={xAt(ts)}
            cy={yAt(e.usage)}
            r={r}
            fill={fill}
            stroke="#0f172a"
            strokeWidth={1}
          />
        )
      })}

      {/* Etichette asse tempo: tMin e tMax (wall-clock), non il primo/ultimo
          sample. Cosi' gli estremi riflettono la finestra selezionata anche
          se non ci sono sample recenti. */}
      <text x={PAD.left} y={H - 8} fontSize={10} fill="rgba(255,255,255,0.5)">
        {new Date(tMin).toLocaleTimeString()}
      </text>
      <text x={W - PAD.right} y={H - 8} fontSize={10} fill="rgba(255,255,255,0.5)" textAnchor="end">
        {new Date(tMax).toLocaleTimeString()}
      </text>

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

    </svg>
  )
}

function Legend() {
  const dot = (color: string, size = 7) => (
    <span aria-hidden="true" style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: color, border: '1px solid #0f172a',
    }} />
  )
  return (
    <div className="px-1 mt-2 text-[10px] text-[var(--color-muted)] space-y-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 2, background: '#22d3ee' }} />
          usage
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block', width: 14, height: 2,
              background: 'repeating-linear-gradient(90deg, #a78bfa 0 4px, transparent 4px 7px)',
            }}
          />
          proiezione
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 2, background: '#64748b' }} />
          ideale
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block', width: 14, height: 7,
              background: 'rgba(34,197,94,0.18)',
              border: '1px solid rgba(34,197,94,0.5)',
            }}
          />
          target 90-95%
        </span>
      </div>
      {/* Punti — chi ha fatto il check (source label nel JSONL) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[var(--color-dim)]">check da:</span>
        <span className="inline-flex items-center gap-1.5">{dot(SOURCE_COLOR.bridge)} bridge</span>
        <span className="inline-flex items-center gap-1.5">{dot(SOURCE_COLOR.capitano, 8)} capitano</span>
        <span className="inline-flex items-center gap-1.5">{dot(SOURCE_COLOR['sentinella-api'], 8)} sentinella·api</span>
        <span className="inline-flex items-center gap-1.5">{dot(SOURCE_COLOR['sentinella-worker'], 8)} sentinella·worker</span>
      </div>
    </div>
  )
}

/** UTC "HH:MM" → "reset tra 2h 14m (19:30 Europe/Rome)". Se tra <60m, solo minuti. */
function formatResetDisplay(reset_at?: string | null): string {
  if (!reset_at) return ''
  const [hStr, mStr] = reset_at.split(':')
  const h = Number(hStr), m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  const now = new Date()
  const resetUTC = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0
  ))
  if (resetUTC.getTime() <= now.getTime()) {
    resetUTC.setUTCDate(resetUTC.getUTCDate() + 1)
  }
  const deltaMin = Math.max(0, Math.round((resetUTC.getTime() - now.getTime()) / 60000))
  const hh = Math.floor(deltaMin / 60)
  const mm = deltaMin % 60
  const remaining = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`
  const localHHMM = resetUTC.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `reset tra ${remaining} (${localHHMM})`
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
            <span style={{ color: '#a78bfa' }}>{entry.projection.toFixed(1)}%</span>
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
  const [nowTs, setNowTs] = useState(() => Date.now())
  // Pan: timestamp in cui termina la finestra del chart (l'estremo destro).
  // null = live mode (segue nowTs); un numero = finestra ancorata a quel
  // momento, l'utente sta navigando il passato. Reset a null quando cambia
  // il range — non ha senso restare ancorati a un istante in 10m se passi a 24h.
  const [panRightTs, setPanRightTs] = useState<number | null>(null)
  useEffect(() => { setPanRightTs(null) }, [range])
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
    // Data fetch ogni 10s — cadenza indipendente dal bridge (1-3m adaptive):
    // appena il bridge scrive un nuovo sample, lo vediamo entro 10s.
    const dataId = setInterval(loadData, 10_000)
    // Wall-clock tick ogni 10s per far scorrere l'asse x. Cosi' anche se
    // non arrivano nuovi dati, il tempo avanza, l'ultimo sample scorre a
    // sinistra e vediamo il chart "vivo" invece che congelato sul punto.
    const clockId = setInterval(() => setNowTs(Date.now()), 10_000)
    return () => { clearInterval(dataId); clearInterval(clockId) }
  }, [loadData])

  // Range temporale: tMax = now (ancorato al clock wall-clock), tMin =
  // now - rangeMinutes. Se "tutto", tMin = timestamp del primo sample.
  // Ricalcolato al tick del clock cosi' l'asse scorre nel tempo.
  const { tMin, tMax } = useMemo(() => {
    const meta = RANGES.find(r => r.id === range) ?? RANGES[1]
    // tMaxCalc: in live mode segue il clock, in pan mode è ancorato a panRightTs
    const tMaxCalc = panRightTs ?? nowTs
    if (!Number.isFinite(meta.minutes)) {
      // "tutto": usa il primo sample come tMin, o 10 min fa se vuoto
      const firstTs = entries.length > 0 ? Date.parse(entries[0].ts) : tMaxCalc - 10 * 60_000
      return { tMin: Number.isFinite(firstTs) ? firstTs : tMaxCalc - 10 * 60_000, tMax: tMaxCalc }
    }
    return { tMin: tMaxCalc - meta.minutes * 60_000, tMax: tMaxCalc }
  }, [range, nowTs, entries, panRightTs])

  const filtered = useMemo(() => {
    return entries.filter(e => {
      const t = Date.parse(e.ts)
      return Number.isFinite(t) && t >= tMin && t <= tMax
    })
  }, [entries, tMin, tMax])

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
              {last.reset_at && (
                <span className="text-[10px] text-[var(--color-dim)]">
                  {formatResetDisplay(last.reset_at)}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* "↺ live" appare solo quando l'utente ha trascinato il chart e
              non è più ancorato al wall-clock. Click → torna ad ancorarsi a now. */}
          {panRightTs !== null && (
            <button
              type="button"
              onClick={() => setPanRightTs(null)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold transition-colors"
              style={{
                background: 'rgba(244,67,54,0.10)',
                color: '#f87171',
                border: '1px solid rgba(244,67,54,0.3)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              title="Torna al tempo corrente"
            >
              ↺ live
            </button>
          )}
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
        <div>
        <div className="relative">
          <Chart
            entries={filtered}
            tMin={tMin}
            tMax={tMax}
            onHover={setHover}
            onPan={(deltaMs) => {
              // "ancora" la finestra: snapshot di nowTs al primo drag così
              // i tick del clock non spostano più la finestra durante il pan.
              setPanRightTs((prev) => (prev ?? nowTs) + deltaMs)
            }}
          />

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
        {/* Legenda sotto il frame del chart */}
        <Legend />
        </div>
      )}

      {filtered.length === 0 && !loading && entries.length > 0 && (
        <div className="text-[10px] text-[var(--color-dim)] text-center mt-2">
          Nessun sample nell&apos;intervallo selezionato — prova &quot;tutto&quot;.
        </div>
      )}
    </div>
  )
}
