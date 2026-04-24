'use client'

import { useEffect, useRef, useState } from 'react'

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

export default function TeamOrgChart({ activeRoles }: { activeRoles?: Set<string> }) {
  const desktopFlowRef = useRef<HTMLDivElement | null>(null)
  const captainNameRef = useRef<HTMLSpanElement | null>(null)
  const agentEmojiRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [arrowOverlay, setArrowOverlay] = useState<{ width: number; height: number; paths: string[]; chainPaths: string[] }>({
    width: 0,
    height: 0,
    paths: [],
    chainPaths: [],
  })

  const isActive = (roleId: string) => activeRoles?.has(roleId) ?? false

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

  return (
    <div className="hidden md:block">
      {/* Animazione LED online: pulse leggero verde */}
      <style>{`
        @keyframes team-orgchart-pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%      { transform: scale(1.4); opacity: 0.55; }
        }
        .team-orgchart-led {
          animation: team-orgchart-pulse 1.4s ease-in-out infinite;
        }
      `}</style>

      <div ref={desktopFlowRef} className="relative mx-auto w-full max-w-[820px]">
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

        {/* Captain da solo al top, centrato (Sentinel rimosso: gestione
             rate-limit è ora il bridge deterministico, non un agente LLM) */}
        <div className="flex justify-center">
          <div className="w-full max-w-[820px] grid grid-cols-5 justify-items-center items-end">
            <span className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 col-start-3">
              <span className="relative">
                <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">{CAPTAIN_AGENT.emoji}</span>
                <ActiveLed active={isActive(CAPTAIN_AGENT.roleId)} />
              </span>
              <span ref={captainNameRef} className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{CAPTAIN_AGENT.name}</span>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-44 -translate-x-1/2 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-center text-[10px] leading-relaxed text-[var(--color-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {CAPTAIN_AGENT.desc}
              </span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-5 justify-items-center items-start mt-16 gap-x-6">
          {PIPELINE_AGENTS.map((agent, index) => (
            <span key={agent.name} className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 min-w-[72px]">
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
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-44 -translate-x-1/2 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-center text-[10px] leading-relaxed text-[var(--color-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {agent.desc}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
