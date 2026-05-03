'use client'

// UsageTokensChart — gemello di UsageChart con asse Y secondario destro
// che sovrappone il cumulativo token weighted del team (kT) sulla linea
// usage%. Serve a validare visivamente la correlazione provider-side
// (% rate budget) ↔ consumo reale dai log locali.
//   • pendenza relativa delle due linee = ratio kT per 1%
//   • se le pendenze divergono dopo un throttle → la calibrazione è sbagliata
//
// Tutto il resto (range selector, drag-to-pan, tooltip, crosshair, sweet
// spot 90-95%) è clone 1:1 di UsageChart.tsx — modifiche allo stesso
// codice vanno propagate qui se ha senso.

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
  { id: '3h',  label: '3h',  minutes: 180 },
  { id: '6h',  label: '6h',  minutes: 6 * 60 },
  { id: '24h', label: '24h', minutes: 24 * 60 },
  { id: 'all', label: 'tutto', minutes: Infinity },
] as const
type RangeId = (typeof RANGES)[number]['id']

// Hover ora è ts-based (non index-based) per supportare timestamp dei token
// (granularità ~30s) oltre ai sample bridge (~5 min). Il Tooltip risolve i
// valori delle 3 linee facendo nearest-lookup su quel ts.
type HoverState = { tsMs: number; xPct: number; yPct: number } | null

type TokenPoint = { tsMs: number; kt: number }
type PredictedPoint = { tsMs: number; usage: number }
type StepEvent = { ts: number; usage: number; kt: number }
type RatioPoint = { tsMs: number; ratio: number }

// Toggle per le 5 linee disegnate dal chart. Ogni voce di legenda e'
// cliccabile e flippa la corrispondente.
type SeriesVisibility = {
  usage: boolean
  predicted: boolean
  ktCum: boolean
  ratio: boolean
  ratioAvg: boolean
}
const DEFAULT_VISIBLE: SeriesVisibility = {
  usage: true, predicted: true, ktCum: true, ratio: false, ratioAvg: true,
}

function Chart({
  entries, predictedSeries, tokenSeries, stepEvents,
  ratioSeries, ratioAvgSeries, visible,
  tMin, tMax, onHover, onPan,
}: {
  entries: Entry[]
  predictedSeries: PredictedPoint[]
  tokenSeries: TokenPoint[]
  stepEvents: StepEvent[]
  ratioSeries: RatioPoint[]
  ratioAvgSeries: RatioPoint[]
  visible: SeriesVisibility
  tMin: number
  tMax: number
  onHover: (h: HoverState) => void
  /** Chiamato durante drag con il delta in millisecondi (positivo = vai avanti
   *  nel tempo, negativo = vai indietro). Il parent applica al panRightTs. */
  onPan?: (deltaMs: number) => void
}) {
  const W = 1200
  const H = 540
  // Right pad allargato per ospitare l'asse secondario (kT cumulativo) +
  // label numeriche con un po' d'aria dal bordo.
  const PAD = { top: 36, right: 96, bottom: 32, left: 56 }
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

  // Auto-zoom Y dinamico: scala calcolata sul range stretto di usage reale
  // + predicted, con padding 15%. Niente projection / ideal nello scope di
  // calcolo — il grafico mostra solo la correlazione % rate budget ↔ token.
  const { yMin, yMax } = useMemo(() => {
    const vals: number[] = []
    for (const e of entries) {
      const t = Date.parse(e.ts)
      if (!Number.isFinite(t) || t < tMin || t > tMax) continue
      if (typeof e.usage === 'number' && Number.isFinite(e.usage)) vals.push(e.usage)
    }
    for (const p of predictedSeries) {
      if (p.tsMs >= tMin && p.tsMs <= tMax && Number.isFinite(p.usage)) vals.push(p.usage)
    }
    if (vals.length === 0) return { yMin: 0, yMax: 100 }
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const range = Math.max(1, hi - lo)
    const pad = Math.max(0.5, range * 0.15)
    return {
      yMin: Math.max(0, lo - pad),
      yMax: hi + pad,
    }
  }, [entries, predictedSeries, tMin, tMax])

  const ySpan = Math.max(0.001, yMax - yMin)
  const yAt = useCallback(
    (v: number) => PAD.top + innerH - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / ySpan) * innerH,
    [innerH, yMin, yMax, ySpan]
  )

  // Asse Y destro: kT cumulativo, auto-zoom su [min, max] visibile (stessa
  // strategia dell'asse sx). Permette alla linea cumulativo di riempire
  // l'altezza utile invece di stare schiacciata in basso quando il range
  // include molta storia.
  const { ktMin, ktMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const p of tokenSeries) {
      if (p.tsMs < tMin || p.tsMs > tMax) continue
      if (p.kt < lo) lo = p.kt
      if (p.kt > hi) hi = p.kt
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ktMin: 0, ktMax: 1 }
    if (hi - lo < 1) return { ktMin: Math.max(0, lo - 0.5), ktMax: hi + 0.5 }
    const range = hi - lo
    const pad = range * 0.1
    return { ktMin: Math.max(0, lo - pad), ktMax: hi + pad }
  }, [tokenSeries, tMin, tMax])

  const ktSpan = Math.max(0.001, ktMax - ktMin)
  const yKt = useCallback(
    (kt: number) => PAD.top + innerH - ((Math.max(ktMin, Math.min(ktMax, kt)) - ktMin) / ktSpan) * innerH,
    [innerH, ktMin, ktMax, ktSpan]
  )

  const fmtKt = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}MT` : `${Math.round(v)}kT`
  const fmtRatio = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(2)} MT/%` : `${v.toFixed(1)} kT/%`

  // Asse Y "interno" per la ratio: scala indipendente da usage e da kT,
  // auto-zoom sul range visibile considerando entrambe le serie ratio
  // (istantanea + media mobile). La linea ratio non condivide l'altezza
  // utile col cumulativo perche' parlerebbero di unita' diverse — usa
  // tutto il box del grafico per leggere bene i valori.
  const { rMin, rMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const series of [ratioSeries, ratioAvgSeries]) {
      for (const p of series) {
        if (p.tsMs < tMin || p.tsMs > tMax) continue
        if (p.ratio < lo) lo = p.ratio
        if (p.ratio > hi) hi = p.ratio
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { rMin: 0, rMax: 1 }
    if (hi - lo < 1) return { rMin: Math.max(0, lo - 0.5), rMax: hi + 0.5 }
    const pad = (hi - lo) * 0.15
    return { rMin: Math.max(0, lo - pad), rMax: hi + pad }
  }, [ratioSeries, ratioAvgSeries, tMin, tMax])

  const rSpan = Math.max(0.001, rMax - rMin)
  const yRatio = useCallback(
    (r: number) => PAD.top + innerH - ((Math.max(rMin, Math.min(rMax, r)) - rMin) / rSpan) * innerH,
    [innerH, rMin, rMax, rSpan]
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

  // RefLines neutre: 5 step uniformi nel range zoomato, niente target /
  // quota / sweet spot — solo gridlines per leggere i valori.
  const refLines = useMemo(() => {
    const out: { v: number }[] = []
    const step = (yMax - yMin) / 4
    const round = (v: number) => {
      if (step >= 10) return Math.round(v)
      if (step >= 1) return Math.round(v * 10) / 10
      return Math.round(v * 100) / 100
    }
    for (let i = 0; i <= 4; i++) out.push({ v: round(yMin + i * step) })
    return out
  }, [yMin, yMax])

  // Mouse → nearest tick by time. Cerchiamo tra TUTTI i tick disponibili:
  // sample bridge (~5 min) + bucket token (~30s) + step events. Così l'hover
  // si aggancia ai punti più granulari (token) e non solo ai 5-min bridge.
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const pxX = e.clientX - rect.left
    const vbX = (pxX / rect.width) * W
    const rel = Math.max(0, Math.min(1, (vbX - PAD.left) / innerW))
    const targetTs = tMin + rel * tSpan
    let bestTs = NaN
    let bestDiff = Infinity
    const consider = (ts: number) => {
      if (!Number.isFinite(ts) || ts < tMin || ts > tMax) return
      const d = Math.abs(ts - targetTs)
      if (d < bestDiff) { bestDiff = d; bestTs = ts }
    }
    for (const en of entries) consider(Date.parse(en.ts))
    for (const p of tokenSeries) consider(p.tsMs)
    for (const s of stepEvents) consider(s.ts)
    if (!Number.isFinite(bestTs)) return
    // Per yPct prendo l'usage più vicino (predicted o reale, in ordine):
    // serve solo per posizionare il tooltip, non è dato semantico.
    let yVal = yMin
    const nearestEntry = entries.reduce<Entry | null>((acc, en) => {
      const t = Date.parse(en.ts)
      if (!Number.isFinite(t)) return acc
      if (acc === null) return en
      return Math.abs(t - bestTs) < Math.abs(Date.parse(acc.ts) - bestTs) ? en : acc
    }, null)
    if (nearestEntry) yVal = nearestEntry.usage
    onHover({
      tsMs: bestTs,
      xPct: (xAt(bestTs) / W) * 100,
      yPct: (yAt(yVal) / H) * 100,
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
      {refLines.map(({ v }) => (
        <g key={`ref-${v}`}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yAt(v)}
            y2={yAt(v)}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="2 6"
            strokeWidth={0.5}
          />
          {/* Label asse % a SINISTRA per non sovrapporsi alle label kT
               dell'asse dx. Allineato a destra (textAnchor=end) per stare
               attaccato al bordo del grafico. */}
          <text
            x={PAD.left - 6}
            y={yAt(v) + 4}
            fontSize={10}
            fill="rgba(34,211,238,0.7)"
            fontFamily="monospace"
            textAnchor="end"
          >
            {Number.isInteger(v) ? `${v}%` : `${v.toFixed(yMax - yMin >= 1 ? 1 : 2)}%`}
          </text>
        </g>
      ))}

      {visible.usage && (
        <path d={pathFor('usage')} stroke="#22d3ee" strokeWidth={3.5} fill="none" />
      )}

      {/* Usage stimato dai token (predicted PIECEWISE):
            usage_pred(t) = anchor.usage + (kt(t) - anchor.kt) / ratio_locale
          Si ricongiunge esattamente alla usage reale ad ogni step event
          (cambio di percentuale). Tra gli step usa il ratio del segmento
          se conosciamo l'arrivo, altrimenti il ratio EMA come stima.
          Asse Y sinistro (stessa scala di usage). */}
      {visible.predicted && (() => {
        const parts: string[] = []
        let prevTs: number | null = null
        for (const p of predictedSeries) {
          if (p.tsMs < tMin || p.tsMs > tMax) { prevTs = null; continue }
          if (!Number.isFinite(p.usage)) { prevTs = null; continue }
          const isGap = prevTs !== null && (p.tsMs - prevTs) > GAP_MS
          const cmd = parts.length === 0 || isGap ? 'M' : 'L'
          parts.push(`${cmd} ${xAt(p.tsMs).toFixed(1)} ${yAt(p.usage).toFixed(1)}`)
          prevTs = p.tsMs
        }
        return (
          <path
            d={parts.join(' ')}
            stroke="#fb923c"
            strokeWidth={3}
            fill="none"
            opacity={0.95}
          />
        )
      })()}

      {/* Linea cumulativo token weighted del team — asse Y destro (giallo).
          Cresce continuamente, riempie l'altezza utile grazie all'auto-zoom
          dx. Permette di vedere a colpo d'occhio quanti kT abbiamo speso e
          a che velocità. */}
      {visible.ktCum && (() => {
        const parts: string[] = []
        let prevTs: number | null = null
        for (const p of tokenSeries) {
          if (p.tsMs < tMin || p.tsMs > tMax) { prevTs = null; continue }
          const isGap = prevTs !== null && (p.tsMs - prevTs) > GAP_MS
          const cmd = parts.length === 0 || isGap ? 'M' : 'L'
          parts.push(`${cmd} ${xAt(p.tsMs).toFixed(1)} ${yKt(p.kt).toFixed(1)}`)
          prevTs = p.tsMs
        }
        return (
          <path
            d={parts.join(' ')}
            stroke="#4ade80"
            strokeWidth={2.5}
            fill="none"
            opacity={0.95}
            strokeDasharray="5 3"
          />
        )
      })()}

      {/* Linea ratio kT/% istantanea — rosa, opacita' bassa per non
          competere con la media mobile. Asse Y dedicato (yRatio).
          E' la stessa serie del vecchio RatioMacroChart. */}
      {visible.ratio && ratioSeries.length > 0 && (
        <path
          d={(() => {
            const parts: string[] = []
            for (const p of ratioSeries) {
              if (p.tsMs < tMin || p.tsMs > tMax) continue
              parts.push(`${parts.length === 0 ? 'M' : 'L'} ${xAt(p.tsMs).toFixed(1)} ${yRatio(p.ratio).toFixed(1)}`)
            }
            return parts.join(' ')
          })()}
          stroke="#ec4899"
          strokeWidth={2}
          fill="none"
          opacity={0.55}
        />
      )}

      {/* Linea media mobile 30 min della ratio — rosa scuro, spessa. */}
      {visible.ratioAvg && ratioAvgSeries.length > 0 && (
        <path
          d={(() => {
            const parts: string[] = []
            for (const p of ratioAvgSeries) {
              if (p.tsMs < tMin || p.tsMs > tMax) continue
              parts.push(`${parts.length === 0 ? 'M' : 'L'} ${xAt(p.tsMs).toFixed(1)} ${yRatio(p.ratio).toFixed(1)}`)
            }
            return parts.join(' ')
          })()}
          stroke="#be185d"
          strokeWidth={2.5}
          fill="none"
        />
      )}

      {/* Label range ratio (lato sinistro, in alto + in basso) quando una
          delle due serie ratio e' visibile. */}
      {(visible.ratio || visible.ratioAvg) && ratioSeries.length > 0 && (
        <>
          <text x={PAD.left + 4} y={PAD.top + 12} fontSize={9}
                fill="rgba(236,72,153,0.85)" fontFamily="monospace">
            ratio max: {fmtRatio(rMax)}
          </text>
          <text x={PAD.left + 4} y={PAD.top + innerH - 4} fontSize={9}
                fill="rgba(236,72,153,0.85)" fontFamily="monospace">
            ratio min: {fmtRatio(rMin)}
          </text>
        </>
      )}

      {/* Step events (anchor di calibrazione): cerchietti arancioni sui
          punti dove usage% cambia (Δ ≥ 1). Sono i ground truth — ad ogni
          marker la predicted ricongiunge alla usage reale. */}
      {/* Step markers: ancorati alla curva usage (sono % bridge), li
          mostriamo solo quando usage e' visibile. Idem se l'utente ha
          esplicitamente tolto il toggle "step", oggi accoppiato a usage. */}
      {visible.usage && stepEvents.map((s, i) => {
        if (s.ts < tMin || s.ts > tMax) return null
        return (
          <circle
            key={`step-${i}`}
            cx={xAt(s.ts)}
            cy={yAt(s.usage)}
            r={5}
            fill="#fb923c"
            stroke="#0f172a"
            strokeWidth={1.5}
          >
            <title>step {i}: usage={s.usage}% · kt={fmtKt(s.kt)}</title>
          </circle>
        )
      })}

      {/* Label asse Y destro (kT) — 5 step uniformi tra ktMin e ktMax. */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const v = ktMin + (ktMax - ktMin) * frac
        return (
          <text
            key={`kt-${frac}`}
            x={W - PAD.right + 6}
            y={yKt(v) + 4}
            fontSize={10}
            fill="rgba(74,222,128,0.95)"
            fontFamily="monospace"
          >
            {fmtKt(v)}
          </text>
        )
      })}

      {/* Sample dots dei check bridge — colorati per source. Vivono sulla
          curva usage, quindi li mostriamo solo se usage e' visibile. */}
      {visible.usage && entries.map((e, i) => {
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

function LegendToggle({
  visible, onToggle,
}: {
  visible: SeriesVisibility
  onToggle: (k: keyof SeriesVisibility) => void
}) {
  // Ogni voce e' un pulsante: click → toggle. Quando OFF la voce e' opaca
  // e barrata. Lo step events marker non e' togglabile (visivo del bridge,
  // sempre rilevante quando vedi usage o predicted).
  type Item = { k: keyof SeriesVisibility; label: string; swatch: React.ReactNode }
  const items: Item[] = [
    { k: 'usage', label: 'usage',
      swatch: <span style={{ display: 'inline-block', width: 14, height: 2, background: '#22d3ee' }} /> },
    { k: 'predicted', label: 'usage stimato dai token (piecewise)',
      swatch: <span style={{ display: 'inline-block', width: 14, height: 2, background: '#fb923c' }} /> },
    { k: 'ktCum', label: 'token kT cumulativo (asse dx)',
      swatch: <span style={{
        display: 'inline-block', width: 14, height: 2,
        background: 'repeating-linear-gradient(90deg, #4ade80 0 5px, transparent 5px 8px)',
      }} /> },
    { k: 'ratioAvg', label: 'ratio kT/% media 30m',
      swatch: <span style={{ display: 'inline-block', width: 14, height: 2, background: '#be185d' }} /> },
    { k: 'ratio', label: 'ratio kT/% istantanea',
      swatch: <span style={{ display: 'inline-block', width: 14, height: 2, background: '#ec4899', opacity: 0.55 }} /> },
  ]
  return (
    <div className="px-1 mt-2 text-[10px] text-[var(--color-muted)] space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {items.map(it => {
          const on = visible[it.k]
          return (
            <button
              key={it.k}
              type="button"
              onClick={() => onToggle(it.k)}
              className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border transition-opacity ${
                on
                  ? 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]'
                  : 'border-transparent opacity-40 line-through hover:opacity-70'
              }`}
              title={on ? `Click per nascondere: ${it.label}` : `Click per mostrare: ${it.label}`}
            >
              <span aria-hidden="true">{it.swatch}</span>
              {it.label}
            </button>
          )
        })}
        {/* Step marker e' ancorato a usage: lo mostriamo nella legenda
            solo se usage e' visibile, sennò lo nascondiamo come i puntini. */}
        {visible.usage && (
          <span className="inline-flex items-center gap-1.5 text-[var(--color-dim)]">
            <span aria-hidden="true" style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: '#fb923c', border: '1px solid #0f172a',
            }} />
            step (Δusage ≥ 1)
          </span>
        )}
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

function nearestByTs<T extends { tsMs: number }>(arr: T[], tsMs: number): T | null {
  if (arr.length === 0) return null
  let best = arr[0]
  let bestDiff = Math.abs(arr[0].tsMs - tsMs)
  for (const p of arr) {
    const d = Math.abs(p.tsMs - tsMs)
    if (d < bestDiff) { best = p; bestDiff = d }
  }
  return best
}

function Tooltip({
  tsMs, entries, predictedSeries, tokenSeries, ratioAvgSeries, sessionStart,
}: {
  tsMs: number
  entries: Entry[]
  predictedSeries: PredictedPoint[]
  tokenSeries: TokenPoint[]
  ratioAvgSeries: RatioPoint[]
  sessionStart: { usage: number; kt: number } | null
}) {
  const ts = new Date(tsMs)
  let nearestEntry: Entry | null = null
  let nearestEntryDiff = Infinity
  for (const e of entries) {
    const t = Date.parse(e.ts)
    if (!Number.isFinite(t)) continue
    const d = Math.abs(t - tsMs)
    if (d < nearestEntryDiff) { nearestEntryDiff = d; nearestEntry = e }
  }
  const pred = nearestByTs(predictedSeries, tsMs)
  const tok = nearestByTs(tokenSeries, tsMs)
  const fmtKt = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(2)} MT` : `${v.toFixed(1)} kT`
  const fmtRatio = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(2)} MT/%` : `${v.toFixed(1)} kT/%`
  return (
    <div className="pointer-events-none">
      <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-wide">
        {ts.toLocaleTimeString()} · {ts.toLocaleDateString()}
      </div>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[11px] font-mono">
        {nearestEntry && (
          <>
            <div>
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 10, height: 2, background: '#22d3ee',
                verticalAlign: 'middle', marginRight: 6,
              }} />
              <span className="text-[var(--color-dim)]">usage:</span>
            </div>
            <div className="text-[var(--color-bright)] font-semibold">{nearestEntry.usage}%</div>
          </>
        )}

        {pred && Number.isFinite(pred.usage) && (
          <>
            <div>
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 10, height: 2, background: '#fb923c',
                verticalAlign: 'middle', marginRight: 6,
              }} />
              <span className="text-[var(--color-dim)]">stimato:</span>
            </div>
            <div style={{ color: '#fb923c' }}>{pred.usage.toFixed(2)}%</div>
          </>
        )}

        {tok && (
          <>
            <div>
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 10, height: 2,
                background: 'repeating-linear-gradient(90deg, #4ade80 0 5px, transparent 5px 8px)',
                verticalAlign: 'middle', marginRight: 6,
              }} />
              <span className="text-[var(--color-dim)]">cumulativo:</span>
            </div>
            <div style={{ color: '#fde047' }}>{fmtKt(tok.kt)}</div>
          </>
        )}

        {/* Ratio macro: calcolo diretto = consumati cumulativi / Δusage
            cumulativo dalla nascita sessione monitorata. Rosa pallido. */}
        {tok && nearestEntry && sessionStart && (() => {
          const dKt = tok.kt - sessionStart.kt
          const dU = nearestEntry.usage - sessionStart.usage
          if (dU <= 0 || dKt <= 0) return null
          const macroRatio = dKt / dU
          return (
            <>
              <div>
                <span aria-hidden="true" style={{
                  display: 'inline-block', width: 10, height: 2, background: '#ec4899',
                  opacity: 0.55, verticalAlign: 'middle', marginRight: 6,
                }} />
                <span className="text-[var(--color-dim)]">ratio:</span>
              </div>
              <div style={{ color: '#ec4899' }} title={`${fmtKt(dKt)} ÷ ${dU}% = ${fmtRatio(macroRatio)}`}>
                {fmtRatio(macroRatio)}
              </div>
            </>
          )
        })()}

        {/* Media mobile 30m della ratio (rosa scuro). */}
        {(() => {
          const avg = nearestByTs(ratioAvgSeries, tsMs)
          if (!avg) return null
          return (
            <>
              <div>
                <span aria-hidden="true" style={{
                  display: 'inline-block', width: 10, height: 2, background: '#be185d',
                  verticalAlign: 'middle', marginRight: 6,
                }} />
                <span className="text-[var(--color-dim)]">media 30m:</span>
              </div>
              <div style={{ color: '#be185d' }}>{fmtRatio(avg.ratio)}</div>
            </>
          )
        })()}
      </div>
    </div>
  )
}

function fmtKtCompact(v: number): string {
  if (v < 1000) return `${v.toFixed(1)} kT`
  if (v < 1_000_000) return `${(v / 1000).toFixed(2)} MT`
  return `${(v / 1_000_000).toFixed(2)} GT`
}

function BudgetWidgets({
  stats, ratio, breakdown, etaResetMs, etaTo100Ms,
}: {
  stats: {
    consumedKt: number
    budgetKt: number | null
    remainingKt: number | null
    sessionStart: { ts: number; usage: number; kt: number }
  }
  ratio: number | null
  breakdown: { in: number; out: number; cr: number; cc: number } | null
  etaResetMs: number | null
  etaTo100Ms: number | null
}) {
  const startTime = new Date(stats.sessionStart.ts)
  const usedPct = stats.budgetKt && stats.budgetKt > 0
    ? Math.min(100, (stats.consumedKt / stats.budgetKt) * 100)
    : null

  const cellStyle = {
    background: 'rgba(34,211,238,0.06)',
    border: '1px solid rgba(34,211,238,0.25)',
  }
  const budgetStyle = {
    background: 'rgba(74,222,128,0.06)',
    border: '1px solid rgba(74,222,128,0.25)',
  }
  const etaStyle = (color: string) => ({
    background: `${color}10`,
    border: `1px solid ${color}50`,
  })

  // Verdetto: confronto ETA al 100% con ETA reset
  let verdict: { color: string; label: string } | null = null
  if (etaTo100Ms !== null && etaResetMs !== null && etaResetMs > 0) {
    const margin = etaTo100Ms / etaResetMs  // > 1 = reset arriva prima del 100% → safe
    if (margin > 1.3) verdict = { color: '#4ade80', label: 'safe' }
    else if (margin > 1.05) verdict = { color: '#facc15', label: 'stretto' }
    else verdict = { color: '#f87171', label: 'sfori' }
  }

  const consumedTitle = breakdown
    ? `Composizione raw del consumo:\n  input  ${fmtKtCompact(breakdown.in)}\n  output ${fmtKtCompact(breakdown.out)}\n  cache_read ${fmtKtCompact(breakdown.cr)}\n  cache_creation ${fmtKtCompact(breakdown.cc)}\n\nWeighted: ${fmtKtCompact(stats.consumedKt)} (con i pesi correnti)`
    : `Token consumati dal primo monitoraggio (${startTime.toLocaleTimeString()})`

  return (
    <>
      <div
        className="flex flex-col px-2 py-1 rounded text-[10px] font-mono leading-tight"
        style={cellStyle}
        title={consumedTitle}
      >
        <span className="text-[var(--color-dim)] uppercase tracking-wide text-[9px]">consumati</span>
        <span style={{ color: '#22d3ee', fontWeight: 600 }}>{fmtKtCompact(stats.consumedKt)}</span>
      </div>

      <div
        className="flex flex-col px-2 py-1 rounded text-[10px] font-mono leading-tight"
        style={budgetStyle}
        title={
          stats.budgetKt !== null && ratio !== null
            ? `Budget = (100% - ${stats.sessionStart.usage}%) × ${ratio.toFixed(1)} kT/% = ${fmtKtCompact(stats.budgetKt)}.\nRimanenti: ${stats.remainingKt !== null ? fmtKtCompact(stats.remainingKt) : '—'}`
            : 'Calibrando ratio: budget non ancora calcolabile'
        }
      >
        <span className="text-[var(--color-dim)] uppercase tracking-wide text-[9px]">
          budget {usedPct !== null ? `· ${usedPct.toFixed(0)}% usato` : ''}
        </span>
        <span style={{ color: '#4ade80', fontWeight: 600 }}>
          {stats.budgetKt !== null ? fmtKtCompact(stats.budgetKt) : '—'}
        </span>
      </div>

      {verdict && etaTo100Ms !== null && etaResetMs !== null && (
        <div
          className="flex flex-col px-2 py-1 rounded text-[10px] font-mono leading-tight"
          style={etaStyle(verdict.color)}
          title={`ETA al 100% (a ritmo attuale): ${fmtDuration(etaTo100Ms)}\nETA reset: ${fmtDuration(etaResetMs)}\nVerdetto: ${verdict.label}`}
        >
          <span className="text-[var(--color-dim)] uppercase tracking-wide text-[9px]">
            ETA 100% · {verdict.label}
          </span>
          <span style={{ color: verdict.color, fontWeight: 600 }}>{fmtDuration(etaTo100Ms)}</span>
        </div>
      )}

    </>
  )
}

function fmtDuration(ms: number): string {
  if (ms < 0) return '—'
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h ${m}m`
}

// Pesi RATE LIMIT Kimi K2 (NON pricing). Da platform.kimi.ai/docs/introduction:
// "rate limit is determined based on the number of tokens in your request
// Pesi rate-Kimi DERIVATI EMPIRICAMENTE (non dalla doc piattaforma).
// Su 28 segmenti / 6h, il modello (input + output) e' nettamente piu'
// stabile (CoV 15% a Δu>=10) di all-tokens (CoV 39%, drift 1.7x), perche'
// cache_read non contribuisce al rate budget come la doc lascia intendere.
// Stessa scelta in shared/skills/token-by-agent-series.py — i due punti
// devono restare allineati altrimenti UI e tabella throttle divergono.
// Razionale completo: docs/internal/2026-05-03-rate-kimi-weights.md
const FALLBACK_W: Weights = { input: 1.0, output: 1.0, cacheR: 0.0, cacheC: 0.0 }

// Watchdog: range atteso della ratio macro con i pesi di sopra. Se siamo
// fuori, mostriamo un badge giallo nell'header per ricordare di rifare
// l'analisi (i pesi sono hardcoded e non si auto-aggiustano).
const RATIO_OK_MIN_KT_PER_PCT = 25.0
const RATIO_OK_MAX_KT_PER_PCT = 60.0

type Weights = { input: number; output: number; cacheR: number; cacheC: number }
type TypeBucket = { tsMs: number; in: number; out: number; cr: number; cc: number }


export default function UsageTokensChart() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [tokenSeries, setTokenSeries] = useState<TokenPoint[]>([])
  // 4 totali team separati per bucket — base per la calibrazione dei pesi.
  const [typeBuckets, setTypeBuckets] = useState<TypeBucket[]>([])
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

  // 4 totali team separati (input/output/cache_read/cache_creation) cumulativi.
  // Sorgente: /api/tokens/by-type. Servono per:
  //   - calibrare i 4 pesi del rate limit via least-squares
  //   - mostrare il breakdown per tipo nei widget
  //   - calcolare il weighted_team con i pesi calibrati (o fallback documentati)
  const loadTokens = useCallback(async () => {
    const meta = RANGES.find(r => r.id === range) ?? RANGES[1]
    const sinceMin = Number.isFinite(meta.minutes)
      ? Math.max(10, Math.min(24 * 60, Math.round(meta.minutes)))
      : 24 * 60
    const bucketSec = sinceMin > 6 * 60 ? 300 : 60
    try {
      const r = await fetch(
        `/api/tokens/by-type?sinceMin=${sinceMin}&bucketSec=${bucketSec}`,
        { cache: 'no-store' },
      )
      const j = await r.json()
      if (!j.ok || !Array.isArray(j.series)) return
      const buckets: TypeBucket[] = []
      for (const row of j.series as Array<Record<string, unknown>>) {
        const tsMs = typeof row.ts === 'string' ? Date.parse(row.ts) : NaN
        if (!Number.isFinite(tsMs)) continue
        buckets.push({
          tsMs,
          in: typeof row.input_kt === 'number' ? row.input_kt : 0,
          out: typeof row.output_kt === 'number' ? row.output_kt : 0,
          cr: typeof row.cache_read_kt === 'number' ? row.cache_read_kt : 0,
          cc: typeof row.cache_creation_kt === 'number' ? row.cache_creation_kt : 0,
        })
      }
      setTypeBuckets(buckets)
    } catch { /* best-effort */ }
  }, [range])

  useEffect(() => {
    loadData()
    loadTokens()
    const dataId = setInterval(loadData, 10_000)
    // Token fetch più lento (30s): payload più pesante, l'aggregazione
    // server-side gira a ogni richiesta. 30s basta per la correlazione visiva.
    const tokenId = setInterval(loadTokens, 30_000)
    const clockId = setInterval(() => setNowTs(Date.now()), 10_000)
    return () => { clearInterval(dataId); clearInterval(tokenId); clearInterval(clockId) }
  }, [loadData, loadTokens])

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

  // ── Calibrazione ratio kT/% — dinamica, provider-agnostic ─────────
  //
  // Idea: trovare il segmento più lungo CONTINUO della cronologia che
  //   1) appartiene alla stessa finestra rate-limit del provider
  //   2) ha un Δusage > 0 (così il ratio è ben definito)
  //
  // Il segmento parte dal "session start": ultimo punto in cui usage è
  // sceso bruscamente (>30 punti = reset finestra del provider) o, in
  // assenza, dal primo sample disponibile.
  //
  // ratio = (kt_now - kt_session_start) / (usage_now - usage_session_start)
  //
  // → kT per 1% di rate budget. Si raffina nel tempo (più punti = più
  // preciso). Niente costanti hardcoded: funziona uguale per Kimi, Claude,
  // Codex, qualsiasi provider che esponga usage% + log token locali.
  const sessionStartIdx = useMemo(() => {
    if (entries.length === 0) return -1
    let start = 0
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]?.usage
      const curr = entries[i]?.usage
      if (typeof prev === 'number' && typeof curr === 'number' && prev - curr > 30) {
        start = i // reset event → nuova sessione
      }
    }
    return start
  }, [entries])

  // Trova il bucket typeBucket col timestamp più vicino a tsMs (binary search
  // perché typeBuckets è ordinato per ts).
  function nearestTypeBucket(tsMs: number): TypeBucket | null {
    if (typeBuckets.length === 0) return null
    let lo = 0, hi = typeBuckets.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (typeBuckets[mid].tsMs < tsMs) lo = mid + 1
      else hi = mid
    }
    let best = typeBuckets[lo]
    let bestDiff = Math.abs(typeBuckets[lo].tsMs - tsMs)
    if (lo > 0) {
      const d = Math.abs(typeBuckets[lo - 1].tsMs - tsMs)
      if (d < bestDiff) { best = typeBuckets[lo - 1]; bestDiff = d }
    }
    return best
  }

  // Applica i pesi w ai 4 totali del bucket → kT weighted (= unità del rate).
  function weightedKt(b: TypeBucket, w: Weights): number {
    return b.in * w.input + b.out * w.output + b.cr * w.cacheR + b.cc * w.cacheC
  }

  // Step events estesi: per ogni cambio di percentuale registriamo NON SOLO
  // (ts, usage) ma anche i 4 totali team al ts dello step (in/out/cr/cc).
  // Questi 4 totali sono la base per la regressione least-squares che
  // calibra i veri pesi del rate limit.
  const stepEventsRaw = useMemo(() => {
    if (sessionStartIdx < 0 || typeBuckets.length === 0) return []
    const session = entries.slice(sessionStartIdx)
    const out: { ts: number; usage: number; in: number; out: number; cr: number; cc: number }[] = []
    let lastUsage = -Infinity
    for (const e of session) {
      const ts = Date.parse(e.ts)
      if (!Number.isFinite(ts) || typeof e.usage !== 'number') continue
      const isFirst = out.length === 0
      const isStep = e.usage >= lastUsage + 1
      if (isFirst || isStep) {
        const b = nearestTypeBucket(ts)
        if (b !== null) {
          out.push({ ts, usage: e.usage, in: b.in, out: b.out, cr: b.cr, cc: b.cc })
          lastUsage = e.usage
        }
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, sessionStartIdx, typeBuckets])

  // Pesi rate-limit Kimi K2 fissi a 1.0 uniformi (cfr. doc piattaforma:
  // il TPM conta input + max_completion_tokens uniformemente, REGARDLESS
  // del cache). La regressione least-squares che provavamo prima dava
  // R²~0.49 con pesi assurdi (cR≈0) — multicollinearita' tra i 4 tipi:
  // crescono insieme perche' ogni risposta del modello ha cache_read
  // dominante (97% del totale), quindi il sistema non li puo' separare.
  // Risultato pratico: la curva kT cumulative del chart era 1450x sotto
  // la realta' (47 kT contro 68 MT veri). Tornando ai pesi documentati
  // i numeri quadrano col rate budget bridge.
  const currentWeights = FALLBACK_W

  // Ora derivo: tokenSeries (per il chart, weighted con currentWeights) e
  // stepEvents (vecchia struct {ts, usage, kt}, kt = weighted del bucket
  // più vicino). I componenti downstream non vedono il refactor.
  useEffect(() => {
    const points: TokenPoint[] = typeBuckets.map(b => ({
      tsMs: b.tsMs,
      kt: weightedKt(b, currentWeights),
    }))
    setTokenSeries(points)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeBuckets, currentWeights.input, currentWeights.output, currentWeights.cacheR, currentWeights.cacheC])

  const stepEvents = useMemo(() => {
    return stepEventsRaw.map(s => ({
      ts: s.ts,
      usage: s.usage,
      kt: s.in * currentWeights.input + s.out * currentWeights.output + s.cr * currentWeights.cacheR + s.cc * currentWeights.cacheC,
    }))
  }, [stepEventsRaw, currentWeights])

  // Calibrazione MACRO cumulativa — stima più stabile del ratio kT/%.
  //
  //   ratio_macro = (kt_last_anchor - kt_first_anchor) / (usage_last - usage_first)
  //
  // È il ratio "complessivo della sessione". A differenza dell'EMA dei
  // singoli segmenti — che è dominata dal rumore di quantizzazione (bridge
  // mostra usage intero quindi un Δusage="1" è in realtà in [0.01, 1.99]) —
  // il ratio macro converge al valore vero man mano che cumuliamo storia.
  // Manteniamo anche EMA + lastRatio come metriche di debug visualizzate
  // dalla quarta linea / tooltip, ma per badge/budget/predicted-tail usiamo
  // sempre la stima macro.
  const calibration = useMemo(() => {
    if (stepEvents.length < 2) return null
    const first = stepEvents[0]
    const last = stepEvents[stepEvents.length - 1]
    const dUmacro = last.usage - first.usage
    const dKmacro = last.kt - first.kt
    if (dUmacro <= 0 || dKmacro <= 0) return null
    const macroRatio = dKmacro / dUmacro

    // EMA segmenti — solo per display informativo (quarta linea).
    const segRatios: number[] = []
    for (let i = 1; i < stepEvents.length; i++) {
      const dKt = stepEvents[i].kt - stepEvents[i - 1].kt
      const dU = stepEvents[i].usage - stepEvents[i - 1].usage
      if (dU > 0 && dKt > 0) segRatios.push(dKt / dU)
    }
    let ema = segRatios.length > 0 ? segRatios[0] : macroRatio
    for (let i = 1; i < segRatios.length; i++) ema = 0.3 * segRatios[i] + 0.7 * ema

    return {
      ratio: macroRatio,           // ← NUOVO: macro cumulativo, stabile
      samples: stepEvents.length,
      lastRatio: segRatios.length > 0 ? segRatios[segRatios.length - 1] : macroRatio,
      emaRatio: ema,               // EMA segmenti, per debug
    }
  }, [stepEvents])

  // Ratio kT/% macro CONTINUA — un punto per ogni bucket di tokenSeries,
  // con usage_t = ultimo step bridge raggiunto. Cosi' la curva e' continua,
  // arriva fino a 'now' e nei plateau di usage sale (corretto: stiamo
  // bruciando token senza muovere usage). Stessa formula del vecchio
  // RatioMacroChart, qui inglobata insieme a usage / predicted / kt.
  const macroRatioSeries = useMemo<RatioPoint[]>(() => {
    if (stepEvents.length < 2 || tokenSeries.length === 0) return []
    const first = stepEvents[0]
    const out: RatioPoint[] = []
    let stepIdx = 0
    for (const tok of tokenSeries) {
      if (tok.tsMs < first.ts) continue
      while (stepIdx + 1 < stepEvents.length && stepEvents[stepIdx + 1].ts <= tok.tsMs) {
        stepIdx++
      }
      const usageNow = stepEvents[stepIdx].usage
      const dKt = tok.kt - first.kt
      const dU = usageNow - first.usage
      if (dU > 0 && dKt > 0) out.push({ tsMs: tok.tsMs, ratio: dKt / dU })
    }
    return out
  }, [stepEvents, tokenSeries])

  // Media mobile 30 min sulla ratio — smussa il rumore dei primi sample
  // e dei plateau brevi. Sliding window O(n).
  const ratioAvgSeries = useMemo<RatioPoint[]>(() => {
    if (macroRatioSeries.length === 0) return []
    const MA_WIN_MS = 30 * 60_000
    const out: RatioPoint[] = []
    let lo = 0
    let sum = 0
    for (let hi = 0; hi < macroRatioSeries.length; hi++) {
      sum += macroRatioSeries[hi].ratio
      while (macroRatioSeries[hi].tsMs - macroRatioSeries[lo].tsMs > MA_WIN_MS) {
        sum -= macroRatioSeries[lo].ratio
        lo++
      }
      out.push({ tsMs: macroRatioSeries[hi].tsMs, ratio: sum / (hi - lo + 1) })
    }
    return out
  }, [macroRatioSeries])

  // Toggle visibilita' delle 5 linee. Persistenza in localStorage cosi' al
  // refresh ritroviamo lo stesso layout. Se vuoi reset: clear UTC.
  const [visibleSeries, setVisibleSeries] = useState<SeriesVisibility>(() => {
    if (typeof window === 'undefined') return DEFAULT_VISIBLE
    try {
      const raw = window.localStorage.getItem('UsageTokensChart.visible')
      if (raw) return { ...DEFAULT_VISIBLE, ...JSON.parse(raw) }
    } catch { /* ignore */ }
    return DEFAULT_VISIBLE
  })
  useEffect(() => {
    try { window.localStorage.setItem('UsageTokensChart.visible', JSON.stringify(visibleSeries)) }
    catch { /* ignore */ }
  }, [visibleSeries])
  const toggle = useCallback((k: keyof SeriesVisibility) => {
    setVisibleSeries(v => ({ ...v, [k]: !v[k] }))
  }, [])

  // Stats sessione monitorata — usate dai widget sopra il grafico.
  //   • sessionStart  = primo anchor (quando abbiamo iniziato a monitorare)
  //   • consumedKt    = token spesi dalla nascita sessione fino ad ora
  //   • budgetKt      = budget totale della finestra calcolato come
  //                     (100 - usage_iniziale) * ratio. Se siamo entrati a
  //                     monitorare a 5%, abbiamo a disposizione 95 punti
  //                     percentuali fino al reset, ognuno vale `ratio` kT.
  //   • remainingKt   = budget - consumed
  // Il budget si raffina automaticamente man mano che il ratio EMA migliora.
  const budgetStats = useMemo(() => {
    if (stepEvents.length === 0 || tokenSeries.length === 0) return null
    const sessionStart = stepEvents[0]
    const lastTok = tokenSeries[tokenSeries.length - 1]
    const consumedKt = Math.max(0, lastTok.kt - sessionStart.kt)
    if (!calibration) {
      return { consumedKt, budgetKt: null, remainingKt: null, sessionStart }
    }
    const budgetKt = (100 - sessionStart.usage) * calibration.ratio
    const remainingKt = Math.max(0, budgetKt - consumedKt)
    return { consumedKt, budgetKt, remainingKt, sessionStart }
  }, [stepEvents, tokenSeries, calibration])

  // Breakdown raw del consumo cumulativo dalla nascita sessione monitorata,
  // per ogni dei 4 tipi (in/out/cr/cc). Mostrato nel tooltip del widget
  // "consumati" così l'utente vede DOVE va il consumo.
  const consumedBreakdown = useMemo(() => {
    if (stepEventsRaw.length === 0 || typeBuckets.length === 0) return null
    const start = stepEventsRaw[0]
    const last = typeBuckets[typeBuckets.length - 1]
    return {
      in: Math.max(0, last.in - start.in),
      out: Math.max(0, last.out - start.out),
      cr: Math.max(0, last.cr - start.cr),
      cc: Math.max(0, last.cc - start.cc),
    }
  }, [stepEventsRaw, typeBuckets])

  // ETA al 100% e ETA reset, calcolate dal ritmo attuale.
  //   ETA al 100% = (budgetKt - consumedKt) / rate_corrente_kt_per_ms
  //   rate corrente = consumo medio negli ultimi 3 min del tokenSeries
  //   ETA reset    = ms al reset_at del provider
  const { etaTo100Ms, etaResetMs } = useMemo(() => {
    let etaTo100Ms: number | null = null
    let etaResetMs: number | null = null
    // ETA reset: dal sample bridge più recente che ha reset_at
    for (let i = entries.length - 1; i >= 0; i--) {
      const r = entries[i].reset_at
      if (!r) continue
      const [hStr, mStr] = r.split(':')
      const h = Number(hStr), m = Number(mStr)
      if (!Number.isFinite(h) || !Number.isFinite(m)) break
      const now = new Date()
      const target = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0,
      ))
      if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1)
      etaResetMs = target.getTime() - now.getTime()
      break
    }
    // ETA al 100%: serve budget e ratio attuale
    if (budgetStats?.remainingKt !== null && budgetStats?.remainingKt !== undefined && tokenSeries.length >= 2) {
      // Rate kT/ms = (kt_now - kt_3min_ago) / Δms
      const last = tokenSeries[tokenSeries.length - 1]
      const cutoff = last.tsMs - 3 * 60 * 1000
      let earliest = tokenSeries[0]
      for (const p of tokenSeries) {
        if (p.tsMs >= cutoff) { earliest = p; break }
      }
      const dKt = last.kt - earliest.kt
      const dMs = last.tsMs - earliest.tsMs
      if (dKt > 0 && dMs > 0) {
        const ratePerMs = dKt / dMs
        etaTo100Ms = budgetStats.remainingKt / ratePerMs
      }
    }
    return { etaTo100Ms, etaResetMs }
  }, [entries, tokenSeries, budgetStats])

  // Serie predicted PIECEWISE:
  //   • per ogni token point, trovo l'ANCHOR più recente (lo step ≤ ts)
  //   • se esiste un NEXT step, uso il ratio di QUEL segmento (ground truth
  //     già misurato → predicted ricongiunge esattamente al next step)
  //   • se siamo nell'ultimo segmento "in corso" (no NEXT), uso `lastRatio`
  //     (ratio dell'ultimo segmento misurato) invece dell'EMA. Più reattivo:
  //     se il team ha cambiato ritmo (es. nuovi scrittori partiti), il ratio
  //     più recente lo cattura mentre l'EMA sarebbe ancora indietro. EMA
  //     resta usato per badge e budget (lì serve stabilità).
  //
  // Risultato: predicted parte esatta a ogni anchor, sale continua tra gli
  // anchor, e si ricongiunge a usage reale ad ogni cambio di percentuale.
  const predictedSeries = useMemo<PredictedPoint[]>(() => {
    if (stepEvents.length === 0 || tokenSeries.length === 0) return []
    const out: PredictedPoint[] = []
    let stepIdx = 0
    for (const p of tokenSeries) {
      while (stepIdx + 1 < stepEvents.length && stepEvents[stepIdx + 1].ts <= p.tsMs) {
        stepIdx++
      }
      const anchor = stepEvents[stepIdx]
      if (p.tsMs < anchor.ts) continue // token point prima del primo anchor
      let ratio: number | null = null
      if (stepIdx + 1 < stepEvents.length) {
        const next = stepEvents[stepIdx + 1]
        const dU = next.usage - anchor.usage
        const dK = next.kt - anchor.kt
        if (dU > 0 && dK > 0) ratio = dK / dU
      } else if (calibration) {
        // Tail "in corso": uso il ratio MACRO cumulativo (stabile e
        // realistico) invece di lastRatio o EMA, che soffrono del rumore
        // della quantizzazione bridge sui singoli segmenti.
        ratio = calibration.ratio
      }
      if (ratio === null || ratio <= 0) continue
      out.push({
        tsMs: p.tsMs,
        usage: anchor.usage + (p.kt - anchor.kt) / ratio,
      })
    }
    return out
  }, [stepEvents, tokenSeries, calibration])

  const last = filtered.length > 0 ? filtered[filtered.length - 1] : null
  // L'hover è ora ts-based: il Tooltip risolve i 3 valori (usage / predicted /
  // kt) tramite nearest-lookup. Non c'è più un "entry corrente" — può anche
  // essere un punto pure-token tra due tick bridge.
  const hoveredTsMs = hover?.tsMs ?? null

  return (
    <div ref={containerRef}>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-dim)]">Rate budget + usage stimato dai token</span>
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
          {calibration ? (
            ((): React.ReactNode => {
              const r = calibration.ratio
              const outOfRange = r < RATIO_OK_MIN_KT_PER_PCT || r > RATIO_OK_MAX_KT_PER_PCT
              const bg = outOfRange ? 'rgba(250,204,21,0.10)' : 'rgba(251,146,60,0.10)'
              const fg = outOfRange ? '#facc15' : '#fb923c'
              const border = outOfRange ? 'rgba(250,204,21,0.45)' : 'rgba(251,146,60,0.3)'
              const tt = outOfRange
                ? `⚠ ratio ${r.toFixed(1)} kT/% FUORI RANGE atteso ${RATIO_OK_MIN_KT_PER_PCT}-${RATIO_OK_MAX_KT_PER_PCT}.\nI pesi token (1, 1, 0, 0) sono hardcoded — possibilmente Kimi ha cambiato il rate model, o cambia la composizione del team.\nNON cambiare i pesi automaticamente: rifai l'analisi su una sessione fresca.\nVedi docs/internal/2026-05-03-rate-kimi-weights.md`
                : `Ratio macro cumulativo dalla nascita sessione (${calibration.samples} step). EMA segmenti: ${calibration.emaRatio.toFixed(1)} kT/%. Ultimo segmento: ${calibration.lastRatio.toFixed(1)} kT/%. In range atteso ${RATIO_OK_MIN_KT_PER_PCT}-${RATIO_OK_MAX_KT_PER_PCT} kT/%.`
              return (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: bg, color: fg, border: `1px solid ${border}` }}
                  title={tt}
                >
                  {outOfRange && '⚠ '}ratio {r < 1
                    ? `${r.toFixed(2)} kT/%`
                    : r < 1000
                      ? `${r.toFixed(1)} kT/%`
                      : `${(r / 1000).toFixed(2)} MT/%`}
                  {' · '}
                  <span style={{ color: outOfRange ? 'rgba(250,204,21,0.7)' : 'rgba(251,146,60,0.7)' }}>
                    {calibration.samples} step
                  </span>
                </span>
              )
            })()
          ) : (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{
                background: 'rgba(148,163,184,0.10)',
                color: 'var(--color-dim)',
                border: '1px solid var(--color-border)',
              }}
              title="Servono ≥2 sample con Δusage > 0 dalla nascita sessione provider"
            >
              ratio: calibrando…
            </span>
          )}

          {/* Widget consumati / budget — affiancati al badge ratio. */}
          {budgetStats && (
            <BudgetWidgets
              stats={budgetStats}
              ratio={calibration?.ratio ?? null}
              breakdown={consumedBreakdown}
              etaResetMs={etaResetMs}
              etaTo100Ms={etaTo100Ms}
            />
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
            predictedSeries={predictedSeries}
            tokenSeries={tokenSeries}
            stepEvents={stepEvents}
            ratioSeries={macroRatioSeries}
            ratioAvgSeries={ratioAvgSeries}
            visible={visibleSeries}
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
          {hover && hoveredTsMs !== null && (
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
                <Tooltip
                  tsMs={hoveredTsMs}
                  entries={entries}
                  predictedSeries={predictedSeries}
                  tokenSeries={tokenSeries}
                  ratioAvgSeries={ratioAvgSeries}
                  sessionStart={budgetStats?.sessionStart ?? null}
                />
              </div>
            </>
          )}
        </div>
        {/* Legenda sotto il frame del chart */}
        <LegendToggle visible={visibleSeries} onToggle={toggle} />
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
