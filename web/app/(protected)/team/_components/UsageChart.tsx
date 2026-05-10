'use client'

// UsageChart — mini-dashboard interattivo del budget rate-limit per la
// pagina Team. Riusa gli stessi dati di /api/sentinella/data (alimentato
// dal bridge) + aggiunge:
//   - range selector (1h / 6h / 24h / all)
//   - tooltip hover con tutti i metrici del punto
//   - crosshair verticale che segue il mouse
//
// Il grafico completo con controlli e terminale resta su /team/sentinella.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

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

// niceStep — passo "rotondo" (1, 2, 5 × 10^k) per generare ~targetCount tick
// equispaziati su un range numerico. Standard d3.ticks.
function niceStep(range: number, targetCount: number): number {
  if (range <= 0 || targetCount <= 0) return 1
  const raw = range / targetCount
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / exp
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10
  return nice * exp
}

// Tabella di passi temporali "umani". niceTimeStep sceglie il primo
// >= della granularità desiderata (= span/target), così
// il numero di tick visibili sta vicino ma non oltre target.
const TIME_STEPS_MS = [
  1_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
  60 * 60_000, 2 * 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000,
  24 * 60 * 60_000, 2 * 24 * 60 * 60_000, 7 * 24 * 60 * 60_000,
]
function niceTimeStep(spanMs: number, targetCount: number): number {
  const desired = spanMs / Math.max(1, targetCount)
  for (const s of TIME_STEPS_MS) if (s >= desired) return s
  return TIME_STEPS_MS[TIME_STEPS_MS.length - 1]
}
function formatTickTime(ts: number, stepMs: number): string {
  const d = new Date(ts)
  if (stepMs >= 24 * 60 * 60_000) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  const opts: Intl.DateTimeFormatOptions = stepMs < 60_000
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' }
  return d.toLocaleTimeString([], opts)
}

function Chart({
  entries, tMin, tMax, yMax, onHover, onPan,
}: {
  entries: Entry[]; tMin: number; tMax: number;
  /** Limite superiore dell'asse Y, controllato dal parent tramite lo
   *  slider verticale. Riducendolo si zoomma sui dati bassi (il frame
   *  del SVG resta della stessa dimensione). */
  yMax: number;
  onHover: (h: HoverState) => void;
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

  // NIENTE clamp qui: i valori fuori scala devono uscire fisicamente dal
  // frame (poi un <clipPath> li ritaglia al bordo superiore). Se invece
  // facessimo Math.min(yMax, v), una proiezione a 200% con yMax=100 si
  // appiattirebbe sulla linea dei 100, generando un segmento orizzontale
  // artificiale che confonde.
  const yAt = useCallback(
    (v: number) => PAD.top + innerH - (v / yMax) * innerH,
    [innerH, yMax]
  )

  // ID stabile per il clipPath (per evitare collisioni se più Chart
  // coesistono nella stessa pagina con stesso id "chart-area").
  const reactId = useId()
  const clipId = `chart-clip-${reactId.replace(/:/g, '')}`

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

  // Tick Y dinamici: passo "rotondo" che produce ~5-6 livelli equispaziati
  // sull'intervallo [0, yMax]. Quando lo slider Y zoomma sui valori bassi
  // (yMax=50), ottieni 0/10/20/30/40/50; con yMax=300 ottieni 0/50/100/.../300.
  const yTicks: number[] = (() => {
    const step = niceStep(yMax, 5)
    const out: number[] = []
    for (let v = 0; v <= yMax + 1e-6; v += step) out.push(Math.round(v * 100) / 100)
    return out
  })()

  // Tick X dinamici: scelgo step temporale "umano" (1m, 5m, 1h, ...) tale
  // che il numero di tick ≈ innerW / 90px (per evitare sovrapposizione
  // delle label "HH:MM"). Filtro i tick fuori dalla regione visibile.
  const xTickCountTarget = Math.max(2, Math.floor(innerW / 90))
  const xTickStep = niceTimeStep(tSpan, xTickCountTarget)
  const xTicks: number[] = (() => {
    const out: number[] = []
    const start = Math.ceil(tMin / xTickStep) * xTickStep
    for (let t = start; t <= tMax; t += xTickStep) {
      const px = xAt(t)
      if (px >= PAD.left - 0.5 && px <= W - PAD.right + 0.5) out.push(t)
    }
    return out
  })()

  // Quote di riferimento "speciali" (sweet spot 90-95 + linea quota 100):
  // mostrate solo se rientrano nella scala Y corrente, così quando si zoomma
  // sui valori bassi non si schiacciano in cima sopra altre label.
  const showSweet = yMax >= 95
  const showQuota = yMax >= 100

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
      {/* Maschera dell'area chart: tutto ciò che disegniamo dentro il
          gruppo clippato sotto viene ritagliato a questo rettangolo. Serve
          per le serie dati: una proiezione a 200% con yMax=100 esce dal
          bordo superiore invece di appiattirsi. */}
      <defs>
        <clipPath id={clipId}>
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
        </clipPath>
      </defs>

      {/* Sweet spot 90-95% (target dove vogliamo stare). Solo se entro yMax
          per evitare schiacciamenti in cima quando si zoomma sui valori bassi. */}
      {showSweet && (
        <>
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
          {/* Label "target" a SINISTRA della banda, dentro l'area chart, così
              non finisce sopra le label dei tick Y a destra. */}
          <text
            x={PAD.left + 4}
            y={yAt(92.5) + 3}
            fontSize={9}
            fill="rgba(34,197,94,0.75)"
            fontWeight="600"
          >
            target
          </text>
        </>
      )}

      {/* Tick Y: griglia + label percentuale a destra. Le label dei valori
          speciali (95, 100) non vengono rese qui — è sempre il tick rotondo
          a vincere — la natura "speciale" è data dalla linea evidenziata
          sotto, non dalla label, così evitiamo doppioni. */}
      {yTicks.map(v => (
        <g key={`y-${v}`}>
          <line
            x1={PAD.left} x2={W - PAD.right}
            y1={yAt(v)} y2={yAt(v)}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="2 6"
            strokeWidth={0.5}
          />
          <text x={W - PAD.right + 5} y={yAt(v) + 4} fontSize={10} fill="rgba(255,255,255,0.5)">
            {v}%
          </text>
        </g>
      ))}

      {/* Linea quota 95% (bordo superiore sweet spot) */}
      {showSweet && (
        <line
          x1={PAD.left} x2={W - PAD.right}
          y1={yAt(95)} y2={yAt(95)}
          stroke="#facc15" strokeDasharray="4 4" strokeWidth={1}
        />
      )}
      {/* Linea quota 100% (limite hard) */}
      {showQuota && (
        <line
          x1={PAD.left} x2={W - PAD.right}
          y1={yAt(100)} y2={yAt(100)}
          stroke="#f87171" strokeDasharray="4 4" strokeWidth={1}
        />
      )}

      {/* Tutte le serie dati e i marker sono dentro il clip dell'area chart:
          se un valore eccede yMax la linea esce dall'alto invece di
          appiattirsi sul tetto (idem per i punti). */}
      <g clipPath={`url(#${clipId})`}>
        <path d={pathFor('projection')} stroke="#a78bfa" strokeWidth={1.3} fill="none" strokeDasharray="5 4" opacity={0.7} />
        <path d={pathFor('velocity_ideal')} stroke="#64748b" strokeWidth={1} fill="none" opacity={0.5} />
        <path d={pathFor('velocity_smooth')} stroke="#f472b6" strokeWidth={1.2} fill="none" opacity={0.85} />
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
      </g>

      {/* Tick X: ogni tick ha una piccola tacca verticale + label HH:MM
          (o HH:MM:SS per range < 1m, o data per range > 1d). Lo step è
          calcolato per evitare sovrapposizioni (~90px per label). */}
      {xTicks.map(t => {
        const px = xAt(t)
        // Allineamento label per non uscire dai bordi:
        // primi tick → start, ultimi → end, in mezzo → middle.
        const distLeft = px - PAD.left
        const distRight = W - PAD.right - px
        const anchor = distLeft < 30 ? 'start' : distRight < 30 ? 'end' : 'middle'
        return (
          <g key={`x-${t}`}>
            <line
              x1={px} x2={px}
              y1={H - PAD.bottom} y2={H - PAD.bottom + 4}
              stroke="rgba(255,255,255,0.4)" strokeWidth={0.6}
            />
            <text
              x={px} y={H - 10}
              fontSize={10} fill="rgba(255,255,255,0.55)"
              textAnchor={anchor}
              fontFamily="monospace"
            >
              {formatTickTime(t, xTickStep)}
            </text>
          </g>
        )
      })}

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
          <span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 2, background: '#f472b6' }} />
          velocità
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
  // Override del dominio degli assi (zoom sui dati, non sulla dimensione del SVG):
  //  - yMaxOverride: tetto manuale dell'asse Y; null = auto-fit sui dati visibili
  //  - xSpanOverride: ampiezza della finestra temporale in minuti; null = segue
  //    il bottone di range. Reset entrambi quando l'utente cambia bottone di
  //    range, così la nuova vista riparte da auto.
  const [yMaxOverride, setYMaxOverride] = useState<number | null>(null)
  const [xSpanOverride, setXSpanOverride] = useState<number | null>(null)
  useEffect(() => {
    setPanRightTs(null)
    setYMaxOverride(null)
    setXSpanOverride(null)
  }, [range])
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
  // Se xSpanOverride è settato (slider X), prende la precedenza sul bottone
  // di range — così l'utente regola finemente l'ampiezza temporale.
  const { tMin, tMax } = useMemo(() => {
    const meta = RANGES.find(r => r.id === range) ?? RANGES[1]
    const tMaxCalc = panRightTs ?? nowTs
    if (xSpanOverride !== null) {
      return { tMin: tMaxCalc - xSpanOverride * 60_000, tMax: tMaxCalc }
    }
    if (!Number.isFinite(meta.minutes)) {
      // "tutto": usa il primo sample come tMin, o 10 min fa se vuoto
      const firstTs = entries.length > 0 ? Date.parse(entries[0].ts) : tMaxCalc - 10 * 60_000
      return { tMin: Number.isFinite(firstTs) ? firstTs : tMaxCalc - 10 * 60_000, tMax: tMaxCalc }
    }
    return { tMin: tMaxCalc - meta.minutes * 60_000, tMax: tMaxCalc }
  }, [range, nowTs, entries, panRightTs, xSpanOverride])

  const filtered = useMemo(() => {
    return entries.filter(e => {
      const t = Date.parse(e.ts)
      return Number.isFinite(t) && t >= tMin && t <= tMax
    })
  }, [entries, tMin, tMax])

  // yMax automatico: fit sui dati visibili (era dentro Chart, ora qui
  // perché serve come default dello slider Y e per renderlo controllato
  // dall'override).
  const yMaxAuto = useMemo(() => {
    let m = 100
    for (const e of filtered) {
      for (const v of [e.usage, e.projection, e.velocity_ideal, e.velocity_smooth] as (number | undefined | null)[]) {
        if (typeof v === 'number' && Number.isFinite(v) && v > m) m = v
      }
    }
    return Math.ceil(m / 10) * 10 + 10
  }, [filtered])

  const yMax = yMaxOverride ?? yMaxAuto

  // X span effettivo in minuti — usato come valore dello slider X.
  const rangeMeta = RANGES.find(r => r.id === range) ?? RANGES[1]
  const xSpanCurrent = xSpanOverride ?? (
    Number.isFinite(rangeMeta.minutes)
      ? (rangeMeta.minutes as number)
      : Math.max(5, Math.round((tMax - tMin) / 60_000))
  )

  // Slider X in scala log (5min → 24h): la log-scale dà controllo fine
  // anche sui range piccoli (con scala lineare 5 minuti = 0.3% del range
  // ed è impossibile da centrare).
  const X_MIN = 5
  const X_MAX = 1440
  const xToSlider = (m: number) =>
    (Math.log(Math.max(X_MIN, Math.min(X_MAX, m))) - Math.log(X_MIN)) /
    (Math.log(X_MAX) - Math.log(X_MIN))
  const sliderToX = (s: number) =>
    Math.round(Math.exp(Math.log(X_MIN) + s * (Math.log(X_MAX) - Math.log(X_MIN))))

  const last = filtered.length > 0 ? filtered[filtered.length - 1] : null
  const hovered = hover && filtered[hover.index] ? filtered[hover.index] : null

  const formatSpan = (m: number) =>
    m >= 60 ? `${(m / 60).toFixed(m % 60 === 0 ? 0 : 1)}h` : `${m}m`

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
        {/* Layout: chart al centro, slider Y verticale a destra (controlla
            il tetto dell'asse Y), slider X orizzontale sotto (controlla
            l'ampiezza temporale). Le dimensioni del SVG NON cambiano:
            cambia solo il dominio mostrato. */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
          <div className="relative" style={{ flex: 1, minWidth: 0 }}>
            <Chart
              entries={filtered}
              tMin={tMin}
              tMax={tMax}
              yMax={yMax}
              onHover={setHover}
              onPan={(deltaMs) => {
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
          {/* Slider verticale: controlla il tetto dell'asse Y. Trascinando
              verso il basso → yMax si riduce → zoom sui valori bassi (es.
              vedi 0-50% a tutto schermo). Doppio click: torna ad auto. */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span className="text-[9px] font-mono text-[var(--color-dim)]" title="tetto asse Y">
              {Math.round(yMax)}%
            </span>
            <input
              type="range"
              min={5}
              max={500}
              step={1}
              value={Math.min(500, Math.max(5, yMax))}
              onChange={(e) => setYMaxOverride(Number(e.target.value))}
              onDoubleClick={() => setYMaxOverride(null)}
              title={`asse Y: 0-${Math.round(yMax)}% ${yMaxOverride === null ? '(auto)' : ''} — doppio click: reset auto`}
              aria-label="Tetto asse Y"
              className="dom-slider dom-slider-v"
              style={{
                writingMode: 'vertical-lr' as React.CSSProperties['writingMode'],
                direction: 'rtl',
                WebkitAppearance: 'slider-vertical' as React.CSSProperties['WebkitAppearance'],
                width: 14,
                flex: 1,
              }}
            />
            <span
              className="text-[9px] font-mono"
              style={{ color: yMaxOverride === null ? 'var(--color-dim)' : '#22d3ee' }}
              title={yMaxOverride === null ? 'auto-fit sui dati' : 'override manuale'}
            >
              {yMaxOverride === null ? 'auto' : 'man'}
            </span>
          </div>
        </div>
        {/* Slider orizzontale: controlla l'ampiezza temporale (zoom X).
            Scala log per dare controllo fine sui range brevi. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span className="text-[9px] font-mono text-[var(--color-dim)] w-12 text-right" title="finestra temporale">
            {formatSpan(xSpanCurrent)}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={xToSlider(xSpanCurrent)}
            onChange={(e) => setXSpanOverride(sliderToX(Number(e.target.value)))}
            onDoubleClick={() => setXSpanOverride(null)}
            title={`finestra: ${formatSpan(xSpanCurrent)} ${xSpanOverride === null ? '(da bottone)' : '(slider)'} — doppio click: reset`}
            aria-label="Ampiezza temporale"
            className="dom-slider dom-slider-h"
            style={{ flex: 1 }}
          />
          <span
            className="text-[9px] font-mono"
            style={{ color: xSpanOverride === null ? 'var(--color-dim)' : '#22d3ee' }}
            title={xSpanOverride === null ? 'segue il bottone di range' : 'override manuale'}
          >
            {xSpanOverride === null ? 'auto' : 'man'}
          </span>
        </div>
        {/* Legenda sotto */}
        <Legend />
        <style jsx>{`
          .dom-slider {
            -webkit-appearance: none;
            appearance: none;
            background: rgba(255, 255, 255, 0.06);
            border-radius: 6px;
            outline: none;
            cursor: pointer;
          }
          .dom-slider-h { height: 10px; }
          .dom-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            background: rgba(34, 211, 238, 0.55);
            border: 1px solid rgba(34, 211, 238, 0.8);
            border-radius: 4px;
            cursor: grab;
          }
          .dom-slider-h::-webkit-slider-thumb {
            width: 48px;
            height: 10px;
          }
          .dom-slider-v::-webkit-slider-thumb {
            width: 14px;
            height: 48px;
          }
          .dom-slider:active::-webkit-slider-thumb { cursor: grabbing; }
          .dom-slider::-moz-range-thumb {
            background: rgba(34, 211, 238, 0.55);
            border: 1px solid rgba(34, 211, 238, 0.8);
            border-radius: 4px;
            cursor: grab;
            width: 48px;
            height: 10px;
          }
          .dom-slider::-moz-range-track {
            background: rgba(255, 255, 255, 0.06);
            border-radius: 6px;
          }
        `}</style>
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
