'use client'

import Link from 'next/link'
import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react'

/* ── Tipi ─────────────────────────────────────────────────────────── */

type AgentDef = {
  emoji: string
  role: string
  color: string
  link: string | null
  session: string
}

type AgentStatus = 'idle' | 'spawning' | 'active'
type TeamState = 'idle' | 'starting' | 'ready' | 'stopping'

/* ── Definizioni agenti ───────────────────────────────────────────── */

const CAPITANO: AgentDef = { emoji: '\u{1F468}\u200D\u2708\uFE0F', role: 'Capitano', color: '#ff9100', link: '/capitano', session: 'ALFA' }

const PIPELINE: AgentDef[] = [
  { emoji: '\uD83D\uDD75\uFE0F', role: 'Scout',     color: '#2196f3', link: '/scout',     session: 'SCOUT-1' },
  { emoji: '\u{1F468}\u200D\uD83D\uDD2C', role: 'Analista',  color: '#00e676', link: '/analista',  session: 'ANALISTA-1' },
  { emoji: '\u{1F468}\u200D\uD83D\uDCBB', role: 'Scorer',    color: '#b388ff', link: '/scorer',    session: 'SCORER-1' },
  { emoji: '\u{1F468}\u200D\uD83C\uDFEB', role: 'Scrittore', color: '#ffd600', link: '/scrittore', session: 'SCRITTORE-1' },
  { emoji: '\u{1F468}\u200D\u2696\uFE0F', role: 'Critico',   color: '#f44336', link: '/critico',   session: 'CRITICO' },
]

const SENTINELLA: AgentDef = { emoji: '\uD83D\uDC82', role: 'Sentinella', color: '#607d8b', link: '/sentinella', session: 'SENTINELLA' }

const ALL_AGENTS: AgentDef[] = [CAPITANO, ...PIPELINE, SENTINELLA]

/* ── Componenti ───────────────────────────────────────────────────── */

function StatusDot({ status }: { status: AgentStatus }) {
  const bg =
    status === 'active' ? '#4caf50' :
    status === 'spawning' ? '#ffc107' :
    'rgba(255,255,255,0.15)'
  return (
    <span
      className={status === 'spawning' ? 'status-pulse' : ''}
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: bg,
        transition: 'background-color 0.3s',
      }}
    />
  )
}

function AgentNode({ agent, size = 'md', status = 'idle' }: { agent: AgentDef; size?: 'lg' | 'md' | 'sm'; status?: AgentStatus }) {
  const sizeClass = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-xl' : 'text-2xl'
  const node = (
    <div className="text-center group">
      <div className={`${sizeClass} leading-none mb-1.5 transition-transform group-hover:scale-110`}>{agent.emoji}</div>
      <div className="text-[10px] font-semibold tracking-wide" style={{ color: agent.color }}>{agent.role}</div>
      <div className="mt-1 flex justify-center">
        <StatusDot status={status} />
      </div>
    </div>
  )
  if (agent.link) {
    return <Link href={agent.link} className="no-underline block hover:opacity-80 transition-opacity">{node}</Link>
  }
  return node
}

/* ── Pagina ────────────────────────────────────────────────────────── */

export default function TeamPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const capRef = useRef<HTMLDivElement>(null)
  const pipeRefs = useRef<(HTMLDivElement | null)[]>(new Array(PIPELINE.length).fill(null))
  const sentRef = useRef<HTMLDivElement>(null)
  const [svgData, setSvgData] = useState<{ w: number; h: number; lines: ReactNode[] } | null>(null)

  /* ── Stato team ──────────────────────────────────────────────── */

  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>(() => {
    const init: Record<string, AgentStatus> = {}
    ALL_AGENTS.forEach(a => { init[a.session] = 'idle' })
    return init
  })
  const [teamState, setTeamState] = useState<TeamState>('idle')
  const [error, setError] = useState<string | null>(null)

  const activeCount = ALL_AGENTS.filter(a => statuses[a.session] === 'active').length

  /* ── Fetch status ────────────────────────────────────────────── */

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/team/status')
      const data = await res.json()
      const activeSessions = new Set<string>(
        (data.agents ?? []).map((a: { session: string }) => a.session)
      )

      setStatuses(prev => {
        const next = { ...prev }
        ALL_AGENTS.forEach(a => {
          next[a.session] = activeSessions.has(a.session) ? 'active' : 'idle'
        })
        return next
      })

      const allActive = ALL_AGENTS.every(a => activeSessions.has(a.session))
      const noneActive = ALL_AGENTS.every(a => !activeSessions.has(a.session))
      if (allActive) setTeamState('ready')
      if (noneActive) setTeamState(prev => prev === 'stopping' ? 'idle' : prev)
      return { allActive, noneActive }
    } catch {
      return false
    }
  }, [])

  /* ── Avvio team ──────────────────────────────────────────────── */

  const startTeam = async () => {
    setTeamState('starting')
    setError(null)
    setStatuses(prev => {
      const next = { ...prev }
      ALL_AGENTS.forEach(a => {
        if (next[a.session] !== 'active') next[a.session] = 'spawning'
      })
      return next
    })

    try {
      const res = await fetch('/api/team/start-all', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error ?? 'Avvio fallito')
        setTeamState('idle')
        setStatuses(prev => {
          const next = { ...prev }
          ALL_AGENTS.forEach(a => {
            if (next[a.session] === 'spawning') next[a.session] = 'idle'
          })
          return next
        })
      }
    } catch {
      setError('Errore di rete')
      setTeamState('idle')
    }
  }

  /* ── Stop team ────────────────────────────────────────────────── */

  const stopTeam = async () => {
    setTeamState('stopping')
    setError(null)

    try {
      const res = await fetch('/api/team/stop-all', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error ?? 'Stop fallito')
        setTeamState('ready')
      }
    } catch {
      setError('Errore di rete')
      setTeamState('ready')
    }
  }

  /* ── Polling ─────────────────────────────────────────────────── */

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    if (teamState !== 'starting' && teamState !== 'stopping') return
    const interval = setInterval(async () => {
      const result = await fetchStatus()
      if (!result) return
      if (teamState === 'starting' && result.allActive) clearInterval(interval)
      if (teamState === 'stopping' && result.noneActive) clearInterval(interval)
    }, 3000)
    return () => clearInterval(interval)
  }, [teamState, fetchStatus])

  /* ── SVG measurement ─────────────────────────────────────────── */

  const measure = useCallback(() => {
    const container = containerRef.current
    const cap = capRef.current
    if (!container || !cap) return
    const cr = container.getBoundingClientRect()
    const w = cr.width, h = cr.height
    if (w === 0 || h === 0) return

    const getR = (el: HTMLElement | null) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height }
    }

    const capR = getR(cap)
    const pRects = pipeRefs.current.map(el => getR(el))
    if (!capR || pRects.some(r => !r)) return

    const lines: ReactNode[] = []

    lines.push(
      <defs key="defs">
        <marker id="arrowRight" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0,0 8,3 0,6" fill="var(--color-dim)" opacity="0.7" />
        </marker>
        {PIPELINE.map((agent, i) => i < PIPELINE.length - 1 ? (
          <linearGradient key={`pg-${i}`} id={`pg-${i}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={agent.color} stopOpacity="0.6" />
            <stop offset="100%" stopColor={PIPELINE[i + 1].color} stopOpacity="0.6" />
          </linearGradient>
        ) : null)}
      </defs>
    )

    const capCx = capR.x + capR.w / 2
    const capBy = capR.y + capR.h + 2

    pRects.forEach((pr, i) => {
      const px = pr!.x + pr!.w / 2
      const py = pr!.y - 2
      lines.push(
        <line key={`cap-${i}`} x1={capCx} y1={capBy} x2={px} y2={py}
          stroke="#ff9100" strokeWidth="1" strokeDasharray="4 3" opacity="0.35" />
      )
    })

    for (let i = 0; i < PIPELINE.length - 1; i++) {
      const from = pRects[i]!
      const to = pRects[i + 1]!
      const y = from.y + from.h / 2
      const x1 = from.x + from.w + 4
      const x2 = to.x - 4
      lines.push(
        <line key={`pipe-${i}`} x1={x1} y1={y} x2={x2} y2={y}
          stroke={`url(#pg-${i})`} strokeWidth="2" markerEnd="url(#arrowRight)" />
      )
    }

    const scrittore = pRects[3]!
    const critico = pRects[4]!
    const fbY = critico.y + critico.h + 16
    const fbX1 = critico.x + critico.w / 2
    const fbX2 = scrittore.x + scrittore.w / 2

    lines.push(
      <path key="feedback"
        d={`M ${fbX1} ${critico.y + critico.h + 2} V ${fbY} H ${fbX2} V ${scrittore.y + scrittore.h + 2}`}
        stroke="#f44336" strokeWidth="1.5" strokeDasharray="4 3" fill="none" opacity="0.5" />
    )
    lines.push(
      <text key="fb-lbl" x={(fbX1 + fbX2) / 2} y={fbY + 12}
        fontSize="9" fill="#f44336" fontFamily="ui-monospace, monospace" textAnchor="middle" opacity="0.7">
        feedback
      </text>
    )

    const sentR = getR(sentRef.current)
    if (sentR) {
      const sx = sentR.x + sentR.w / 2
      const sy = sentR.y + sentR.h
      pRects.forEach((pr, i) => {
        const px = pr!.x + pr!.w / 2
        const py = pr!.y
        lines.push(
          <line key={`sent-${i}`} x1={sx} y1={sy} x2={px} y2={py}
            stroke="#607d8b" strokeWidth="1" strokeDasharray="2 4" opacity="0.18" />
        )
      })
    }

    setSvgData({ w, h, lines })
  }, [])

  useEffect(() => {
    const t = setTimeout(measure, 80)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [measure])

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* Pulse animation for spawning dots */}
      <style>{`
        @keyframes status-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .status-pulse { animation: status-pulse 1.5s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Team</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Job Hunter Team</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">Pipeline e comunicazione tra agenti</p>
          </div>
          <div className="flex items-center gap-3">
            {(teamState === 'starting' || teamState === 'stopping') && (
              <span className="text-[10px] text-[var(--color-muted)] tabular-nums">
                {activeCount}/{ALL_AGENTS.length} attivi
              </span>
            )}
            <button
              onClick={startTeam}
              disabled={teamState !== 'idle'}
              style={{
                border: `1px solid ${
                  teamState === 'ready' ? '#4caf50' :
                  teamState === 'starting' ? '#ffc107' :
                  'var(--color-border)'
                }`,
                color:
                  teamState === 'ready' ? '#4caf50' :
                  teamState === 'starting' ? '#ffc107' :
                  'var(--color-muted)',
                background:
                  teamState === 'ready' ? 'rgba(76,175,80,0.1)' :
                  teamState === 'starting' ? 'rgba(255,193,7,0.05)' :
                  'transparent',
                fontFamily: 'inherit',
                fontSize: '11px',
                padding: '6px 16px',
                borderRadius: '4px',
                cursor: teamState === 'idle' ? 'pointer' : 'default',
                letterSpacing: '0.05em',
                transition: 'all 0.25s',
              }}
              onMouseEnter={e => {
                if (teamState === 'idle') {
                  e.currentTarget.style.borderColor = '#4caf50'
                  e.currentTarget.style.color = '#4caf50'
                }
              }}
              onMouseLeave={e => {
                if (teamState === 'idle') {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.color = 'var(--color-muted)'
                }
              }}
            >
              {teamState === 'idle' && '\u25B6 Avvia Team'}
              {teamState === 'starting' && '\u21BB Avvio in corso...'}
              {teamState === 'ready' && '\u2713 Team Pronto'}
              {teamState === 'stopping' && '\u21BB Spegnimento...'}
            </button>
            {(teamState === 'ready' || activeCount > 0) && teamState !== 'stopping' && (
              <button
                onClick={stopTeam}
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-muted)',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  fontSize: '11px',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  letterSpacing: '0.05em',
                  transition: 'all 0.25s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#f44336'
                  e.currentTarget.style.color = '#f44336'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.color = 'var(--color-muted)'
                }}
              >
                {'\u25A0'} Spegni Team
              </button>
            )}
            {teamState === 'stopping' && (
              <span
                style={{
                  border: '1px solid #f44336',
                  color: '#f44336',
                  background: 'rgba(244,67,54,0.05)',
                  fontFamily: 'inherit',
                  fontSize: '11px',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  letterSpacing: '0.05em',
                }}
              >
                {'\u21BB'} Spegnimento...
              </span>
            )}
          </div>
        </div>
        {error && (
          <p className="text-[11px] mt-2" style={{ color: '#f44336' }}>{error}</p>
        )}
      </div>

      {/* Desktop: Pyramid layout */}
      <div ref={containerRef} className="hidden sm:block relative pb-10">
        {svgData && (
          <svg className="absolute inset-0 pointer-events-none" width={svgData.w} height={svgData.h} style={{ overflow: 'visible' }}>
            {svgData.lines}
          </svg>
        )}

        {/* Capitano + Sentinella — top center */}
        <div className="flex justify-center items-end gap-12 mb-20">
          <div ref={capRef}>
            <AgentNode agent={CAPITANO} size="lg" status={statuses[CAPITANO.session]} />
          </div>
          <div ref={sentRef}>
            <AgentNode agent={SENTINELLA} size="md" status={statuses[SENTINELLA.session]} />
          </div>
        </div>

        {/* Pipeline row — left to right */}
        <div className="flex items-center justify-center gap-16">
          {PIPELINE.map((agent, i) => (
            <div key={agent.role} ref={el => { pipeRefs.current[i] = el }}>
              <AgentNode agent={agent} status={statuses[agent.session]} />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: vertical flow */}
      <div className="sm:hidden flex flex-col items-center gap-4">
        <div className="flex items-end gap-6">
          <AgentNode agent={CAPITANO} size="lg" status={statuses[CAPITANO.session]} />
          <AgentNode agent={SENTINELLA} size="md" status={statuses[SENTINELLA.session]} />
        </div>
        <div className="text-[var(--color-dim)] text-xs opacity-50">{'\u25BC'}</div>
        {PIPELINE.map((agent, i) => (
          <div key={agent.role} className="flex flex-col items-center">
            <AgentNode agent={agent} status={statuses[agent.session]} />
            {i < PIPELINE.length - 1 && (
              <div className="text-[var(--color-dim)] text-xs opacity-50 my-2">{'\u2192'}</div>
            )}
          </div>
        ))}
      </div>

    </div>
  )
}
