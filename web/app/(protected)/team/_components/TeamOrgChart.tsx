'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type AgentStatus = 'running' | 'stopped' | 'pending'

type AgentMeta = {
  status: AgentStatus
  color: string
  link?: string | null
  role?: string
}

// roleId: id lato API (cli/web). name: label mostrato nel chart (EN).
const CAPTAIN_AGENT = {
  roleId: 'capitano',
  emoji: '\u{1F468}\u200D\u2708\uFE0F',
  name: 'Captain',
  desc: 'Coordinates the team and assigns operational priorities.',
}

// Sentinel: agente di sicurezza che presidia il monitoring usage. Non
// fa parte della pipeline operativa (scout → critic), siede di lato al
// Captain con un proprio canale di osservazione del rate-limit.
const SENTINEL_AGENT = {
  roleId: 'sentinella',
  emoji: '💂',
  name: 'Sentinel',
  desc: 'Monitors usage and rate-limit health, alerts the Captain on degradations.',
}

// Bridge: strumento elettronico (non agente LLM) che ogni 5 min interroga
// il provider via API/rollout JSONL e notifica la Sentinella con un tick
// fresco. Appare nel grafo perché spedisce messaggi (BRIDGE TICK / BRIDGE
// FAILURE) e l'utente vuole vederli scorrere lungo la freccia. Comunica
// SOLO con la Sentinella — niente canale diretto con il Captain.
const BRIDGE_NODE = {
  roleId: 'bridge',
  emoji: '📡',
  name: 'Bridge',
  desc: 'Electronic probe — every 5 min reads usage from the provider and ticks the Sentinel.',
}

const PIPELINE_AGENTS = [
  { roleId: 'scout',     emoji: '\uD83D\uDD75\uFE0F',            name: 'Scout',   desc: 'Searches for new opportunities on job channels.' },
  { roleId: 'analista',  emoji: '\u{1F468}\u200D\uD83D\uDD2C',   name: 'Analyst', desc: 'Reads requirements and evaluates fit with profile.' },
  { roleId: 'scorer',    emoji: '\u{1F468}\u200D\uD83D\uDCBB',   name: 'Scorer',  desc: 'Calculates priority and match score of offers.' },
  { roleId: 'scrittore', emoji: '\u{1F468}\u200D\uD83C\uDFEB',   name: 'Writer',  desc: 'Prepares tailored CV and cover letter.' },
  { roleId: 'critico',   emoji: '\u{1F468}\u200D\u2696\uFE0F',   name: 'Critic',  desc: 'Reviews materials and flags what needs correction.' },
]

function ActiveLed({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <span
      aria-label="online"
      className="team-orgchart-led"
      style={{
        position: 'absolute',
        top: 0,
        right: -8,
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: '#22c55e',
        boxShadow: '0 0 5px rgba(34,197,94,0.7)',
      }}
    />
  )
}

function MiniSpinner({ size = 11, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="orgchart-spin" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function AgentPopover({
  roleId,
  emoji,
  name,
  desc,
  meta,
  loading,
  onAction,
  onClose,
  placement,
  extraContent,
}: {
  extraContent?: React.ReactNode
  roleId: string
  emoji: string
  name: string
  desc: string
  meta?: AgentMeta
  loading: boolean
  onAction?: (id: string, action: 'start' | 'stop') => void
  onClose: () => void
  placement: 'above' | 'below'
}) {
  const status: AgentStatus = meta?.status ?? 'stopped'
  const color = meta?.color ?? '#ffc107'
  const isRunning = status === 'running'
  const isPending = status === 'pending'
  const disabled = loading || isPending

  const statusText = isRunning ? 'Online' : isPending ? 'Starting...' : 'Offline'
  const statusColor = isRunning ? '#22c55e' : isPending ? '#f59e0b' : 'var(--color-dim)'

  const posStyle: React.CSSProperties = placement === 'above'
    ? { bottom: '100%', marginBottom: 12 }
    : { top: '100%', marginTop: 12 }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`${name} details`}
      className="absolute left-1/2 z-30 w-64 -translate-x-1/2 rounded-xl p-3.5 shadow-2xl"
      style={{
        ...posStyle,
        background: 'var(--color-panel)',
        border: `1px solid ${color}40`,
        boxShadow: `0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px ${color}15`,
        animation: 'orgchart-pop 0.15s ease-out',
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-2 right-2 text-[var(--color-dim)] hover:text-[var(--color-bright)]"
        style={{ fontSize: 14, background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1, padding: 2 }}
      >
        ×
      </button>

      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: `${color}15`, border: `1px solid ${color}30` }}
        >
          {emoji}
        </div>
        <div className="min-w-0">
          {meta?.link ? (
            <Link href={meta.link} className="text-[12px] font-bold no-underline hover:underline" style={{ color: 'var(--color-white)' }}>
              {name}
            </Link>
          ) : (
            <div className="text-[12px] font-bold" style={{ color: 'var(--color-white)' }}>{name}</div>
          )}
          <div className="text-[9px] font-semibold tracking-wide uppercase mt-0.5" style={{ color }}>
            {meta?.role ?? name}
          </div>
        </div>
      </div>

      <p className="text-[10.5px] leading-relaxed mb-3" style={{ color: 'var(--color-muted)' }}>
        {desc}
      </p>

      {extraContent && (
        <div className="mb-3">{extraContent}</div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase" style={{ color: statusColor }}>
          <span
            style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: isRunning ? '#22c55e' : isPending ? '#f59e0b' : 'rgba(255,255,255,0.2)',
              boxShadow: isRunning ? '0 0 6px rgba(34,197,94,0.5)' : isPending ? '0 0 6px rgba(245,158,11,0.5)' : 'none',
            }}
          />
          {statusText}
        </span>

        {onAction && (
          <button
            onClick={() => onAction(roleId, isRunning ? 'stop' : 'start')}
            disabled={disabled}
            aria-label={isRunning ? `Stop ${name}` : `Start ${name}`}
            className="px-3 py-1.5 rounded-lg text-[10.5px] font-semibold transition-all"
            style={{
              background: disabled ? 'var(--color-border)' : isRunning ? 'rgba(244,67,54,0.08)' : `${color}15`,
              color: disabled ? 'var(--color-dim)' : isRunning ? '#f44336' : color,
              border: `1px solid ${disabled ? 'var(--color-border)' : isRunning ? 'rgba(244,67,54,0.2)' : `${color}30`}`,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {loading ? (
              <span className="inline-flex items-center gap-1"><MiniSpinner size={10} /> Wait...</span>
            ) : isRunning ? (
              '\u25A0 Stop'
            ) : (
              '\u25B6 Start'
            )}
          </button>
        )}
      </div>
    </div>
  )
}

type Props = {
  agents?: Record<string, AgentMeta>
  onAction?: (id: string, action: 'start' | 'stop') => void
  actionLoading?: string | null
  /** Backwards-compat: se `agents` non è fornito, usa activeRoles per i LED. */
  activeRoles?: Set<string>
}

type ArrowPath = { id: string; d: string }

// Colori per il pallino del messaggio: stesso codice usato dal parent
// team/page.tsx per le card agenti, così il pallino "ha la voce" del
// mittente. Bridge è grigio acciaio (strumento elettronico, non agente).
const AGENT_COLORS: Record<string, string> = {
  bridge:     '#94a3b8',
  sentinella: '#9c27b0',
  capitano:   '#ff9100',
  scout:      '#2196f3',
  analista:   '#00e676',
  scorer:     '#b388ff',
  scrittore:  '#ffd600',
  critico:    '#f44336',
  assistente: '#26c6da',
}
const colorFor = (roleish: string): string => {
  const key = roleish.toLowerCase().split('-')[0]
  return AGENT_COLORS[key] ?? '#34d399'
}

export default function TeamOrgChart({ agents, onAction, actionLoading, activeRoles }: Props) {
  const desktopFlowRef = useRef<HTMLDivElement | null>(null)
  const captainNameRef = useRef<HTMLSpanElement | null>(null)
  const captainEmojiRef = useRef<HTMLSpanElement | null>(null)
  const agentEmojiRefs = useRef<(HTMLSpanElement | null)[]>([])
  const bridgeEmojiRef = useRef<HTMLSpanElement | null>(null)
  const sentinelEmojiRef = useRef<HTMLSpanElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [arrowOverlay, setArrowOverlay] = useState<{
    width: number
    height: number
    bridgePath: ArrowPath | null
    sentinelToCaptainPath: ArrowPath | null
    captainPaths: ArrowPath[]
    chainPaths: ArrowPath[]
  }>({
    width: 0,
    height: 0,
    bridgePath: null,
    sentinelToCaptainPath: null,
    captainPaths: [],
    chainPaths: [],
  })

  // Animazione "messaggio in transito": ogni elemento qui in lista è una
  // pallina che parte dal source di un path e percorre la freccia fino al
  // dest. Il rendering aggiunge un <circle> con <animateMotion> agganciato
  // al <path id={pathId}>; quando l'animazione finisce, l'elemento viene
  // rimosso da questa lista. Per ora alimentato da un demo cyclic interno
  // (vedi useEffect più sotto); in futuro si collegherà ai messaggi reali
  // tra agenti.
  const [messageAnims, setMessageAnims] = useState<{ key: number; pathId: string; reverse?: boolean; durationMs: number; color: string }[]>([])
  const animKeyRef = useRef(0)
  // Velocità del pallino in px/sec — costante a prescindere dalla lunghezza
  // del path (così Bridge→Sentinel breve e Captain→Scout lungo hanno la
  // stessa "velocità apparente"). 200 px/s è un compromesso: il path più
  // breve (~200px Bridge→Sentinel) ci mette ~1s, il più lungo (~530px
  // Captain→Scout) ~2.6s.
  const PX_PER_SEC = 200
  const MIN_DURATION_MS = 600

  // Helper: aggiunge un'animazione su pathId calcolando la durata in base
  // alla lunghezza reale del path SVG (getTotalLength). Il color è quello
  // del mittente — il pallino "ha la voce" dell'agente che parla.
  const pushAnim = (pathId: string, opts?: { reverse?: boolean; color?: string }) => {
    const pathEl = typeof document !== 'undefined'
      ? (document.getElementById(pathId) as unknown as SVGPathElement | null)
      : null
    const length = pathEl?.getTotalLength?.() ?? 0
    const durationMs = Math.max(MIN_DURATION_MS, Math.round((length / PX_PER_SEC) * 1000))
    const key = ++animKeyRef.current
    const color = opts?.color ?? '#34d399'
    setMessageAnims((prev) => [...prev, { key, pathId, reverse: opts?.reverse, durationMs, color }])
    setTimeout(() => {
      setMessageAnims((prev) => prev.filter((a) => a.key !== key))
    }, durationMs + 800)
  }
  // Per evitare di richiamare beginElement() su un <animateMotion> già
  // avviato (succede quando React ri-rendera il map e il ref callback
  // riceve di nuovo lo stesso elemento → SMIL riavvia l'animation a metà
  // strada). WeakSet così i nodi rimossi dal DOM vengono garbage-collected.
  const startedAnimsRef = useRef<WeakSet<SVGAnimateMotionElement>>(new WeakSet())
  const beginAnim = (el: SVGAnimateMotionElement | null) => {
    if (!el) return
    if (startedAnimsRef.current.has(el)) return
    startedAnimsRef.current.add(el)
    // requestAnimationFrame: dare al browser un frame per registrare il
    // nuovo nodo SMIL e risolvere <mpath href> prima del trigger.
    requestAnimationFrame(() => {
      try { el.beginElement() } catch { /* SMIL non supportato → noop */ }
    })
  }

  // Countdown al prossimo Bridge tick. Calcolato da bridgeNextTickAt che
  // arriva dal backend (= lastTickAt nel JSONL + 5min, l'intervallo reale
  // del bridge Python).
  const [bridgeCountdown, setBridgeCountdown] = useState<number | null>(null)
  // Stato del process Python sentinel-bridge.py (sì/no via /api/bridge/status).
  // Quando il bridge è giù, niente LED, niente countdown, niente animazione
  // demo Bridge→Sentinella. La freccia resta disegnata ma più tenue.
  const [bridgeRunning, setBridgeRunning] = useState<boolean>(false)
  const [bridgePending, setBridgePending] = useState<boolean>(false)
  // Fonte di verità sul timing: il backend legge il sample più recente
  // con source=bridge dal JSONL e ne deriva nextTickAt = lastTickAt + 5min.
  // Niente più timer locale che vede "5 min" finti.
  const [bridgeLastTickAt, setBridgeLastTickAt] = useState<string | null>(null)
  const [bridgeNextTickAt, setBridgeNextTickAt] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const r = await fetch('/api/bridge/status', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json() as { running: boolean; lastTickAt: string | null; nextTickAt: string | null }
        if (!cancelled) {
          setBridgeRunning(!!j.running)
          setBridgeLastTickAt(j.lastTickAt ?? null)
          setBridgeNextTickAt(j.nextTickAt ?? null)
        }
      } catch { /* ignore */ }
    }
    check()
    const interval = setInterval(check, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const handleBridgeAction = async (_id: string, action: 'start' | 'stop') => {
    setBridgePending(true)
    try {
      await fetch(`/api/bridge/${action}`, { method: 'POST' })
      // Refresh status subito dopo il toggle (il polling 3s ci penserebbe ma
      // così l'utente vede il LED reagire immediatamente).
      const r = await fetch('/api/bridge/status', { cache: 'no-store' })
      if (r.ok) {
        const j = await r.json() as { running: boolean }
        setBridgeRunning(!!j.running)
      }
    } catch { /* ignore */ } finally {
      setBridgePending(false)
    }
  }

  const isActive = (roleId: string) => {
    if (agents) return agents[roleId]?.status === 'running'
    return activeRoles?.has(roleId) ?? false
  }

  // Close popover on outside click or Esc
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    const onClick = (e: MouseEvent) => {
      const root = containerRef.current
      if (root && !root.contains(e.target as Node)) setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [selected])

  useEffect(() => {
    let frame = 0

    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const flow = desktopFlowRef.current
        const captainName = captainNameRef.current
        if (!flow || !captainName) return

        const flowRect = flow.getBoundingClientRect()
        const captainRect = captainName.getBoundingClientRect()
        const startX = captainRect.left + captainRect.width / 2 - flowRect.left
        const startY = captainRect.bottom - flowRect.top + 6

        const captainPaths: ArrowPath[] = agentEmojiRefs.current
          .map((node, index) => {
            if (!node || index === 4) return null
            const rect = node.getBoundingClientRect()
            const endX = rect.left + rect.width / 2 - flowRect.left
            const endY = rect.top - flowRect.top - 6
            const id = `captain-to-${PIPELINE_AGENTS[index]?.roleId ?? index}`
            return { id, d: `M ${startX} ${startY} L ${endX} ${endY}` }
          })
          .filter((p): p is ArrowPath => p !== null)

        const agentRects = agentEmojiRefs.current
          .map((node) => (node ? node.getBoundingClientRect() : null))

        const chainPaths: ArrowPath[] = []
        for (let i = 0; i < agentRects.length - 1; i++) {
          const rect = agentRects[i]
          const nextRect = agentRects[i + 1]
          if (!rect || !nextRect) continue
          const sX = rect.right - flowRect.left + 6
          const eX = nextRect.left - flowRect.left - 6
          const y = rect.top + rect.height / 2 - flowRect.top
          const id = `chain-${PIPELINE_AGENTS[i].roleId}-to-${PIPELINE_AGENTS[i + 1].roleId}`
          chainPaths.push({ id, d: `M ${sX} ${y} L ${eX} ${y}` })
        }

        // Bridge → Sentinel: orizzontale top-row. Bridge in col 1, Sentinel
        // in col 2; partiamo dal lato destro del Bridge e arriviamo al lato
        // sinistro della Sentinel. Lo y è preso dal center del Bridge per
        // restare allineato anche se le emoji hanno altezze leggermente
        // diverse (📡 vs 💂).
        let bridgePath: ArrowPath | null = null
        const bridgeNode = bridgeEmojiRef.current
        const sentinelNode = sentinelEmojiRef.current
        const captainEmojiNode = captainEmojiRef.current
        if (bridgeNode && sentinelNode) {
          const bRect = bridgeNode.getBoundingClientRect()
          const sRect = sentinelNode.getBoundingClientRect()
          const sX = bRect.right - flowRect.left + 6
          const eX = sRect.left - flowRect.left - 6
          const y = bRect.top + bRect.height / 2 - flowRect.top
          bridgePath = { id: 'bridge-to-sentinel', d: `M ${sX} ${y} L ${eX} ${y}` }
        }

        // Sentinel → Captain: orizzontale top-row, stessa riga del Bridge.
        // La Sentinella alerta il Capitano quando il filtro decide che vale
        // la pena disturbarlo (proj > 105% o usage >= 90%, vedi suo prompt).
        let sentinelToCaptainPath: ArrowPath | null = null
        if (sentinelNode && captainEmojiNode) {
          const sRect = sentinelNode.getBoundingClientRect()
          const cRect = captainEmojiNode.getBoundingClientRect()
          const sX = sRect.right - flowRect.left + 6
          const eX = cRect.left - flowRect.left - 6
          const y = sRect.top + sRect.height / 2 - flowRect.top
          sentinelToCaptainPath = { id: 'sentinel-to-captain', d: `M ${sX} ${y} L ${eX} ${y}` }
        }

        setArrowOverlay((prev) => {
          const width = Math.round(flowRect.width)
          const height = Math.round(flowRect.height)
          const samePaths = (a: ArrowPath[], b: ArrowPath[]) =>
            a.length === b.length && a.every((p, i) => p.id === b[i].id && p.d === b[i].d)
          const sameOpt = (a: ArrowPath | null, b: ArrowPath | null) =>
            (a === null && b === null) || (a !== null && b !== null && a.id === b.id && a.d === b.d)
          if (
            prev.width === width &&
            prev.height === height &&
            samePaths(prev.captainPaths, captainPaths) &&
            samePaths(prev.chainPaths, chainPaths) &&
            sameOpt(prev.bridgePath, bridgePath) &&
            sameOpt(prev.sentinelToCaptainPath, sentinelToCaptainPath)
          ) {
            return prev
          }
          return { width, height, bridgePath, sentinelToCaptainPath, captainPaths, chainPaths }
        })
      })
    }

    measure()

    const resizeObserver = new ResizeObserver(measure)
    if (desktopFlowRef.current) resizeObserver.observe(desktopFlowRef.current)
    if (captainNameRef.current) resizeObserver.observe(captainNameRef.current)
    if (bridgeEmojiRef.current) resizeObserver.observe(bridgeEmojiRef.current)
    if (sentinelEmojiRef.current) resizeObserver.observe(sentinelEmojiRef.current)
    if (captainEmojiRef.current) resizeObserver.observe(captainEmojiRef.current)
    agentEmojiRefs.current.forEach((node) => {
      if (node) resizeObserver.observe(node)
    })

    window.addEventListener('resize', measure)

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Mapping convenzionale (from/to nel formato `[@X -> @Y]` di jht-tmux-send)
  // → id del path SVG renderizzato. "scrittore"/"critico" sono i nomi italiani
  // usati dagli agenti, gli id dei path seguono PIPELINE_AGENTS.
  const messageRouteToPathId = (from: string, to: string): { id: string; reverse?: boolean } | null => {
    const f = from.toLowerCase().split('-')[0]   // "scout-1" → "scout"
    const t = to.toLowerCase().split('-')[0]
    if (f === 'bridge'    && t === 'sentinella') return arrowOverlay.bridgePath ? { id: arrowOverlay.bridgePath.id } : null
    if (f === 'sentinella'&& t === 'capitano')   return arrowOverlay.sentinelToCaptainPath ? { id: arrowOverlay.sentinelToCaptainPath.id } : null
    if (t === 'sentinella'&& f === 'capitano')   return arrowOverlay.sentinelToCaptainPath ? { id: arrowOverlay.sentinelToCaptainPath.id, reverse: true } : null
    if (f === 'capitano') {
      const p = arrowOverlay.captainPaths.find((x) => x.id === `captain-to-${t}`)
      return p ? { id: p.id } : null
    }
    // Risposta agente → capitano: stessa freccia di captain-to-X percorsa al contrario
    if (t === 'capitano') {
      const p = arrowOverlay.captainPaths.find((x) => x.id === `captain-to-${f}`)
      if (p) return { id: p.id, reverse: true }
    }
    // Chain pipeline: cerca match diretto X-to-Y o reverse Y-to-X
    const direct = arrowOverlay.chainPaths.find((x) => x.id === `chain-${f}-to-${t}`)
    if (direct) return { id: direct.id }
    const rev = arrowOverlay.chainPaths.find((x) => x.id === `chain-${t}-to-${f}`)
    if (rev) return { id: rev.id, reverse: true }
    return null
  }

  // Polling dei messaggi tra agenti: ogni 800ms chiede a /api/team/messages
  // gli eventi più recenti. Per ogni messaggio nuovo, se la coppia from/to
  // ha un path renderizzato, aggiungiamo un'animazione in coda. È il canale
  // che alimenta i pallini sulle frecce reali (post-demo).
  useEffect(() => {
    let cancelled = false
    let cursor: string | null = null
    const poll = async () => {
      try {
        const url = cursor ? `/api/team/messages?since=${encodeURIComponent(cursor)}` : '/api/team/messages'
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json() as { messages: Array<{ ts: string; from: string; to: string }>; cursor: string | null }
        if (cancelled) return
        // Primo poll (cursor null): adottiamo cursor senza animare la storia
        if (cursor === null) {
          cursor = j.cursor
          return
        }
        cursor = j.cursor ?? cursor
        for (const m of j.messages) {
          const route = messageRouteToPathId(m.from, m.to)
          if (!route) continue
          pushAnim(route.id, { reverse: route.reverse, color: colorFor(m.from) })
        }
      } catch { /* network blip → retry next tick */ }
    }
    poll()
    const interval = setInterval(poll, 800)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrowOverlay.bridgePath, arrowOverlay.sentinelToCaptainPath, arrowOverlay.captainPaths, arrowOverlay.chainPaths])

  // Demo Bridge → Sentinella: ogni 15s spawn un pallino sulla freccia
  // Bridge→Sentinel per simulare il [BRIDGE TICK] che il bridge Python
  // manda alla Sentinella ogni 5 min.
  // Quando il backend riporta un nuovo lastTickAt (= il bridge Python ha
  // appena scritto un sample fresh nel JSONL), animiamo il pallino
  // Bridge→Sentinel UNA volta. Il timing è quello reale del bridge,
  // niente più simulazione locale ogni N secondi.
  useEffect(() => {
    if (!bridgeRunning) return
    if (!arrowOverlay.bridgePath) return
    if (!bridgeLastTickAt) return
    pushAnim(arrowOverlay.bridgePath.id, { color: colorFor('bridge') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeLastTickAt, bridgeRunning, arrowOverlay.bridgePath])

  // Countdown ticker: usa nextTickAt REALE dal backend. Cambia ogni 250ms
  // così la cifra in UI cambia esattamente al secondo. Quando nextTickAt
  // arriva, il countdown va a 0 finché il backend non riporta il nuovo
  // lastTickAt (= sample fresh) e il next slitta di +5min.
  useEffect(() => {
    if (!bridgeRunning || !bridgeNextTickAt) {
      setBridgeCountdown(null)
      return
    }
    const targetMs = new Date(bridgeNextTickAt).getTime()
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000))
      setBridgeCountdown(remaining)
    }
    tick()
    const interval = setInterval(tick, 250)
    return () => clearInterval(interval)
  }, [bridgeNextTickAt, bridgeRunning])

  const toggle = (id: string) => setSelected(prev => (prev === id ? null : id))

  return (
    <div className="hidden md:block" ref={containerRef}>
      <style>{`
        @keyframes team-orgchart-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        .team-orgchart-led {
          animation: team-orgchart-pulse 3s ease-in-out infinite;
        }
        @keyframes orgchart-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .orgchart-spin { animation: orgchart-spin 0.8s linear infinite; }
        @keyframes orgchart-pop {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      <div ref={desktopFlowRef} className="relative mx-auto w-full max-w-[1080px]">
        {arrowOverlay.width > 0 && arrowOverlay.height > 0 && (
          arrowOverlay.bridgePath ||
          arrowOverlay.sentinelToCaptainPath ||
          arrowOverlay.captainPaths.length > 0 ||
          arrowOverlay.chainPaths.length > 0
        ) && (
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${arrowOverlay.width} ${arrowOverlay.height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <defs>
              <marker
                id="team-orgchart-arrowhead"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 Z" fill="rgba(255,255,255,0.42)" />
              </marker>
            </defs>

            {arrowOverlay.bridgePath && (
              <path
                id={arrowOverlay.bridgePath.id}
                d={arrowOverlay.bridgePath.d}
                fill="none"
                stroke={bridgeRunning ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)'}
                strokeWidth="1.75"
                strokeLinecap="round"
                markerEnd="url(#team-orgchart-arrowhead)"
                strokeDasharray="4 8"
              />
            )}

            {arrowOverlay.sentinelToCaptainPath && (
              <path
                id={arrowOverlay.sentinelToCaptainPath.id}
                d={arrowOverlay.sentinelToCaptainPath.d}
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="1.75"
                strokeLinecap="round"
                markerEnd="url(#team-orgchart-arrowhead)"
                strokeDasharray="4 8"
              />
            )}

            {arrowOverlay.captainPaths.map((p) => (
              <path
                key={p.id}
                id={p.id}
                d={p.d}
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="1.75"
                strokeLinecap="round"
                markerEnd="url(#team-orgchart-arrowhead)"
                strokeDasharray="4 8"
              />
            ))}

            {arrowOverlay.chainPaths.map((p, index) => (
              <path
                key={p.id}
                id={p.id}
                d={p.d}
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1.35"
                strokeLinecap="round"
                markerStart={index === arrowOverlay.chainPaths.length - 1 ? 'url(#team-orgchart-arrowhead)' : undefined}
                markerEnd="url(#team-orgchart-arrowhead)"
                strokeDasharray="4 8"
              />
            ))}

            {/* Pallini messaggio in transito: ogni elemento di messageAnims
                renderizza un <circle> che percorre il path id-referenziato
                via <animateMotion><mpath/></animateMotion>. Halo morbido
                per far percepire il movimento anche quando passa veloce. */}
            {/* SMIL begin="0s" = 0s dopo il document load, NON dal mount.
                Per animazioni create dinamicamente DOPO il page load (es. il
                tick 2 a +15s), SMIL le considererebbe già finite ("begin era
                15s fa, sei in ritardo, salta alla fine"). Soluzione: begin=
                "indefinite" + beginElement() chiamato dal callback ref nel
                momento in cui l'elemento entra nel DOM. */}
            {messageAnims.map(({ key, pathId, reverse, durationMs, color }) => (
              <g key={key}>
                {/* Halo: stesso colore del mittente, opacità bassa per
                    leggerlo anche su sfondo scuro. */}
                <circle cx="0" cy="0" r="9" fill={color} opacity="0.28">
                  <animateMotion
                    ref={beginAnim}
                    dur={`${durationMs}ms`}
                    begin="indefinite"
                    repeatCount="1"
                    fill="freeze"
                    calcMode="linear"
                    {...(reverse ? { keyPoints: '1;0', keyTimes: '0;1' } : {})}
                  >
                    <mpath href={`#${pathId}`} xlinkHref={`#${pathId}`} />
                  </animateMotion>
                </circle>
                {/* Pallino centrale: colore pieno del mittente. */}
                <circle cx="0" cy="0" r="3.4" fill={color}>
                  <animateMotion
                    ref={beginAnim}
                    dur={`${durationMs}ms`}
                    begin="indefinite"
                    repeatCount="1"
                    fill="freeze"
                    calcMode="linear"
                    {...(reverse ? { keyPoints: '1;0', keyTimes: '0;1' } : {})}
                  >
                    <mpath href={`#${pathId}`} xlinkHref={`#${pathId}`} />
                  </animateMotion>
                </circle>
              </g>
            ))}
          </svg>
        )}

        {/* Top row: Bridge (col 1) → Sentinel (col 2) → Captain centrato
            (col 3). Bridge è uno strumento elettronico, non un agente: non
            ha un canale verso il Captain, comunica solo con la Sentinella.
            La Sentinella resta laterale al Captain perché osserva, non
            comanda. */}
        <div className="flex justify-center">
          <div className="w-full max-w-[1080px] grid grid-cols-5 justify-items-center items-end">
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggle(BRIDGE_NODE.roleId) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(BRIDGE_NODE.roleId) } }}
              aria-expanded={selected === BRIDGE_NODE.roleId}
              aria-label={`${BRIDGE_NODE.name} details`}
              className="relative inline-flex select-none flex-col items-center gap-2 shrink-0 col-start-1 cursor-pointer outline-none"
            >
              <span className="relative">
                <span ref={bridgeEmojiRef} className="text-2xl md:text-3xl leading-none" aria-hidden="true">{BRIDGE_NODE.emoji}</span>
                {/* LED acceso se il bridge sta tickando (cioè se il countdown
                    è inizializzato). Per ora è legato al demo cyclic locale
                    — quando collegheremo il vero stato del process Python
                    bastera' sostituire la condizione con il flag dal backend. */}
                <ActiveLed active={bridgeRunning} />
              </span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{BRIDGE_NODE.name}</span>
              {/* Countdown in absolute così non altera l'altezza del nodo
                  Bridge — altrimenti `items-end` del grid top-row solleverebbe
                  l'emoji per allineare i fondi, sfasando la freccia. */}
              {bridgeRunning && bridgeCountdown !== null && (() => {
                const m = Math.floor(bridgeCountdown / 60)
                const s = bridgeCountdown % 60
                const label = m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
                return (
                  <span
                    className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tabular-nums leading-tight"
                    style={{ color: 'var(--color-dim)' }}
                    aria-label={`Next bridge tick in ${bridgeCountdown} seconds`}
                  >
                    next tick {label}
                  </span>
                )
              })()}

              {selected === BRIDGE_NODE.roleId && (
                <AgentPopover
                  roleId={BRIDGE_NODE.roleId}
                  emoji={BRIDGE_NODE.emoji}
                  name={BRIDGE_NODE.name}
                  desc={BRIDGE_NODE.desc}
                  meta={{
                    status: bridgeRunning ? 'running' : 'stopped',
                    color: AGENT_COLORS.bridge,
                    role: 'Bridge',
                  }}
                  loading={bridgePending}
                  onAction={handleBridgeAction}
                  onClose={() => setSelected(null)}
                  placement="below"
                />
              )}
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggle(SENTINEL_AGENT.roleId) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(SENTINEL_AGENT.roleId) } }}
              aria-expanded={selected === SENTINEL_AGENT.roleId}
              aria-label={`${SENTINEL_AGENT.name} details`}
              className="relative inline-flex select-none flex-col items-center gap-2 shrink-0 col-start-2 cursor-pointer outline-none"
            >
              <span className="relative">
                <span ref={sentinelEmojiRef} className="text-2xl md:text-3xl leading-none" aria-hidden="true">{SENTINEL_AGENT.emoji}</span>
                <ActiveLed active={isActive(SENTINEL_AGENT.roleId)} />
              </span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{SENTINEL_AGENT.name}</span>

              {selected === SENTINEL_AGENT.roleId && (
                <AgentPopover
                  roleId={SENTINEL_AGENT.roleId}
                  emoji={SENTINEL_AGENT.emoji}
                  name={SENTINEL_AGENT.name}
                  desc={SENTINEL_AGENT.desc}
                  meta={agents?.[SENTINEL_AGENT.roleId]}
                  loading={actionLoading === SENTINEL_AGENT.roleId}
                  onAction={onAction}
                  onClose={() => setSelected(null)}
                  placement="below"
                />
              )}
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggle(CAPTAIN_AGENT.roleId) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(CAPTAIN_AGENT.roleId) } }}
              aria-expanded={selected === CAPTAIN_AGENT.roleId}
              aria-label={`${CAPTAIN_AGENT.name} details`}
              className="relative inline-flex select-none flex-col items-center gap-2 shrink-0 col-start-3 cursor-pointer outline-none"
            >
              <span className="relative">
                <span ref={captainEmojiRef} className="text-2xl md:text-3xl leading-none" aria-hidden="true">{CAPTAIN_AGENT.emoji}</span>
                <ActiveLed active={isActive(CAPTAIN_AGENT.roleId)} />
              </span>
              <span ref={captainNameRef} className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{CAPTAIN_AGENT.name}</span>

              {selected === CAPTAIN_AGENT.roleId && (
                <AgentPopover
                  roleId={CAPTAIN_AGENT.roleId}
                  emoji={CAPTAIN_AGENT.emoji}
                  name={CAPTAIN_AGENT.name}
                  desc={CAPTAIN_AGENT.desc}
                  meta={agents?.[CAPTAIN_AGENT.roleId]}
                  loading={actionLoading === CAPTAIN_AGENT.roleId}
                  onAction={onAction}
                  onClose={() => setSelected(null)}
                  placement="below"
                />
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-5 justify-items-center items-start mt-24 gap-x-12">
          {PIPELINE_AGENTS.map((agent, index) => (
            <div
              key={agent.name}
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggle(agent.roleId) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(agent.roleId) } }}
              aria-expanded={selected === agent.roleId}
              aria-label={`${agent.name} details`}
              className="relative inline-flex select-none flex-col items-center gap-2 shrink-0 min-w-[72px] cursor-pointer outline-none"
            >
              <span className="relative">
                <span
                  ref={(node) => {
                    agentEmojiRefs.current[index] = node
                  }}
                  className="text-2xl md:text-3xl leading-none"
                  aria-hidden="true"
                >
                  {agent.emoji}
                </span>
                <ActiveLed active={isActive(agent.roleId)} />
              </span>
              <span className="text-[11px] md:text-[12px] font-semibold tracking-wide text-[var(--color-bright)] text-center">{agent.name}</span>

              {selected === agent.roleId && (
                <AgentPopover
                  roleId={agent.roleId}
                  emoji={agent.emoji}
                  name={agent.name}
                  desc={agent.desc}
                  meta={agents?.[agent.roleId]}
                  loading={actionLoading === agent.roleId}
                  onAction={onAction}
                  onClose={() => setSelected(null)}
                  placement="above"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
