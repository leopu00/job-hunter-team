'use client'

import { useEffect, useRef, useState } from 'react'

const CAPTAIN_AGENT = { emoji: '\u{1F468}\u200D\u2708\uFE0F', name: 'Captain', desc: 'Coordinates the team and assigns operational priorities.' }
const SENTINEL_AGENT = { emoji: '\uD83D\uDC82', name: 'Sentinel', desc: 'Monitors budget, limits and system health.' }

const PIPELINE_AGENTS = [
  { emoji: '\uD83D\uDD75\uFE0F', name: 'Scout', desc: 'Searches for new opportunities on job channels.' },
  { emoji: '\u{1F468}\u200D\uD83D\uDD2C', name: 'Analyst', desc: 'Reads requirements and evaluates fit with profile.' },
  { emoji: '\u{1F468}\u200D\uD83D\uDCBB', name: 'Scorer', desc: 'Calculates priority and match score of offers.' },
  { emoji: '\u{1F468}\u200D\uD83C\uDFEB', name: 'Writer', desc: 'Prepares tailored CV and cover letter.' },
  { emoji: '\u{1F468}\u200D\u2696\uFE0F', name: 'Critic', desc: 'Reviews materials and flags what needs correction.' },
]

export default function TeamOrgChart() {
  const desktopFlowRef = useRef<HTMLDivElement | null>(null)
  const captainNameRef = useRef<HTMLSpanElement | null>(null)
  const agentEmojiRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [arrowOverlay, setArrowOverlay] = useState<{ width: number; height: number; paths: string[]; chainPaths: string[] }>({
    width: 0,
    height: 0,
    paths: [],
    chainPaths: [],
  })

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
      <div ref={desktopFlowRef} className="relative mx-auto w-full max-w-[620px]">
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

        <div className="flex justify-center">
          <div className="w-full max-w-[620px] grid grid-cols-5 justify-items-center items-end">
            <span className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 col-start-2">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">{SENTINEL_AGENT.emoji}</span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{SENTINEL_AGENT.name}</span>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-44 -translate-x-1/2 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-center text-[10px] leading-relaxed text-[var(--color-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {SENTINEL_AGENT.desc}
              </span>
            </span>
            <span className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 col-start-3 -translate-y-3 md:-translate-y-4">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">{CAPTAIN_AGENT.emoji}</span>
              <span ref={captainNameRef} className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{CAPTAIN_AGENT.name}</span>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-44 -translate-x-1/2 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-center text-[10px] leading-relaxed text-[var(--color-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {CAPTAIN_AGENT.desc}
              </span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-5 justify-items-center items-start mt-14">
          {PIPELINE_AGENTS.map((agent, index) => (
            <span key={agent.name} className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 min-w-[72px]">
              <span
                ref={(node) => {
                  agentEmojiRefs.current[index] = node
                }}
                className="text-2xl md:text-3xl leading-none"
                aria-hidden="true"
              >
                {agent.emoji}
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
