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
}: {
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

export default function TeamOrgChart({ agents, onAction, actionLoading, activeRoles }: Props) {
  const desktopFlowRef = useRef<HTMLDivElement | null>(null)
  const captainNameRef = useRef<HTMLSpanElement | null>(null)
  const agentEmojiRefs = useRef<(HTMLSpanElement | null)[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [arrowOverlay, setArrowOverlay] = useState<{ width: number; height: number; paths: string[]; chainPaths: string[] }>({
    width: 0,
    height: 0,
    paths: [],
    chainPaths: [],
  })

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

        const paths = agentEmojiRefs.current
          .map((node, index) => {
            if (!node || index === 4) return null
            const rect = node.getBoundingClientRect()
            const endX = rect.left + rect.width / 2 - flowRect.left
            const endY = rect.top - flowRect.top - 6
            return `M ${startX} ${startY} L ${endX} ${endY}`
          })
          .filter((path): path is string => path !== null)

        const agentRects = agentEmojiRefs.current
          .map((node) => (node ? node.getBoundingClientRect() : null))
          .filter((rect): rect is DOMRect => rect !== null)

        const chainPaths = agentRects
          .slice(0, -1)
          .map((rect, index) => {
            const nextRect = agentRects[index + 1]
            if (!nextRect) return null
            const sX = rect.right - flowRect.left + 6
            const eX = nextRect.left - flowRect.left - 6
            const y = rect.top + rect.height / 2 - flowRect.top
            return `M ${sX} ${y} L ${eX} ${y}`
          })
          .filter((path): path is string => path !== null)

        setArrowOverlay((prev) => {
          const width = Math.round(flowRect.width)
          const height = Math.round(flowRect.height)
          if (
            prev.width === width &&
            prev.height === height &&
            prev.chainPaths.length === chainPaths.length &&
            prev.chainPaths.every((path, index) => path === chainPaths[index]) &&
            prev.paths.length === paths.length &&
            prev.paths.every((path, index) => path === paths[index])
          ) {
            return prev
          }
          return { width, height, paths, chainPaths }
        })
      })
    }

    measure()

    const resizeObserver = new ResizeObserver(measure)
    if (desktopFlowRef.current) resizeObserver.observe(desktopFlowRef.current)
    if (captainNameRef.current) resizeObserver.observe(captainNameRef.current)
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
        {arrowOverlay.width > 0 && arrowOverlay.height > 0 && (arrowOverlay.paths.length > 0 || arrowOverlay.chainPaths.length > 0) && (
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
            {arrowOverlay.paths.map((path) => (
              <path
                key={path}
                d={path}
                fill="none"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="1.75"
                strokeLinecap="round"
                markerEnd="url(#team-orgchart-arrowhead)"
                strokeDasharray="4 8"
              />
            ))}
            {arrowOverlay.chainPaths.map((path, index) => (
              <path
                key={path}
                d={path}
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1.35"
                strokeLinecap="round"
                markerStart={index === arrowOverlay.chainPaths.length - 1 ? 'url(#team-orgchart-arrowhead)' : undefined}
                markerEnd="url(#team-orgchart-arrowhead)"
                strokeDasharray="4 8"
              />
            ))}
          </svg>
        )}

        {/* Captain da solo al top, centrato */}
        <div className="flex justify-center">
          <div className="w-full max-w-[1080px] grid grid-cols-5 justify-items-center items-end">
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
                <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">{CAPTAIN_AGENT.emoji}</span>
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
                  placement="above"
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
