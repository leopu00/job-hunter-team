'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLandingI18n } from './LandingI18n'

const CAPTAIN_AGENT = { emoji: '👨‍✈️', name: 'Captain', desc: 'Coordinates the team and assigns operational priorities.' }
const SENTINEL_AGENT = { emoji: '💂', name: 'Sentinel', desc: 'Monitors budget, limits and system health.' }

const PIPELINE_AGENTS = [
  { emoji: '🕵️', name: 'Scout', desc: 'Searches for new opportunities on job channels.' },
  { emoji: '👨‍🔬', name: 'Analyst', desc: 'Reads requirements and evaluates fit with profile.' },
  { emoji: '👨‍💻', name: 'Scorer', desc: 'Calculates priority and match score of offers.' },
  { emoji: '👨‍🏫', name: 'Writer', desc: 'Prepares tailored CV and cover letter.' },
  { emoji: '👨‍⚖️', name: 'Critic', desc: 'Reviews materials and flags what needs correction.' },
]

export default function LandingHero() {
  const { t } = useLandingI18n()
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
            if (!node || index === 4) return null // Skip Critic (index 4)

            const rect = node.getBoundingClientRect()
            const endX = rect.left + rect.width / 2 - flowRect.left
            const endY = rect.top - flowRect.top - 6

            return `M ${startX} ${startY} L ${endX} ${endY}`
          })
          .filter((path): path is string => path !== null)

        const agentRects = agentEmojiRefs.current
          .map((node) => {
            if (!node) return null
            return node.getBoundingClientRect()
          })
          .filter((rect): rect is DOMRect => rect !== null)

        const chainPaths = agentRects
          .slice(0, -1)
          .map((rect, index) => {
            const nextRect = agentRects[index + 1]
            if (!nextRect) return null

            const startX = rect.right - flowRect.left + 6
            const endX = nextRect.left - flowRect.left - 6
            const y = rect.top + rect.height / 2 - flowRect.left + flowRect.left - flowRect.top

            return `M ${startX} ${y} L ${endX} ${y}`
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
    <section aria-label="Hero" className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 relative overflow-hidden">
      <div className="relative z-10 w-full max-w-6xl mx-auto text-center" style={{ animation: 'fade-in 0.6s ease both' }}>
        <h1 className="w-full text-3xl sm:text-5xl md:text-7xl font-extrabold tracking-tight text-[var(--color-white)] leading-[1.1] mb-6">
          Job Hunter <span className="text-[var(--color-green)]">Team</span>
        </h1>

        <p className="text-[13px] md:text-[15px] text-[var(--color-bright)] leading-relaxed max-w-xl mx-auto mb-4">
          {t('hero_desc_short')}
        </p>

        <div className="inline-flex items-center mb-5">
          <span
            className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]"
          >
            BETA
          </span>
        </div>

      </div>

      <div
        className="relative z-10 w-full max-w-6xl mt-14 px-2"
        style={{ animation: 'fade-in 0.8s ease 0.2s both' }}
      >
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
                    id="captain-arrowhead"
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
                {arrowOverlay.paths.map((path, index) => (
                  <path
                    key={path}
                    d={path}
                    fill="none"
                    stroke="rgba(255,255,255,0.28)"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    markerEnd="url(#captain-arrowhead)"
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
                    markerStart={index === arrowOverlay.chainPaths.length - 1 ? 'url(#captain-arrowhead)' : undefined}
                    markerEnd="url(#captain-arrowhead)"
                    strokeDasharray="4 8"
                  />
                ))}
              </svg>
            )}

            <div className="flex justify-center">
              <div className="w-full max-w-[620px] grid grid-cols-5 justify-items-center items-end">
                <span className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 col-start-2">
                  <span className="text-2xl md:text-3xl leading-none transition-transform duration-150 ease-out group-hover:scale-105" aria-hidden="true">{SENTINEL_AGENT.emoji}</span>
                  <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{SENTINEL_AGENT.name}</span>
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-44 -translate-x-1/2 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-center text-[10px] leading-relaxed text-[var(--color-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    {SENTINEL_AGENT.desc}
                  </span>
                </span>
                <span className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 col-start-3 -translate-y-3 md:-translate-y-4">
                  <span className="text-2xl md:text-3xl leading-none transition-transform duration-150 ease-out group-hover:scale-105" aria-hidden="true">{CAPTAIN_AGENT.emoji}</span>
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
                      className="text-2xl md:text-3xl leading-none transition-transform duration-150 ease-out group-hover:scale-105"
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

        <div className="md:hidden">
          <div className="flex justify-center mb-8">
            <div className="w-full max-w-[620px] grid grid-cols-5 justify-items-center items-end gap-x-6 md:gap-x-8">
              <span className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 col-start-2">
                <span className="text-2xl md:text-3xl leading-none transition-transform duration-150 ease-out group-hover:scale-105" aria-hidden="true">{SENTINEL_AGENT.emoji}</span>
                <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{SENTINEL_AGENT.name}</span>
                <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-40 -translate-x-1/2 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-center text-[10px] leading-relaxed text-[var(--color-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {SENTINEL_AGENT.desc}
                </span>
              </span>
              <span className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 col-start-3 -translate-y-3 md:-translate-y-4">
                <span className="text-2xl md:text-3xl leading-none transition-transform duration-150 ease-out group-hover:scale-105" aria-hidden="true">{CAPTAIN_AGENT.emoji}</span>
                <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">{CAPTAIN_AGENT.name}</span>
                <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-40 -translate-x-1/2 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-center text-[10px] leading-relaxed text-[var(--color-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {CAPTAIN_AGENT.desc}
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-start justify-start gap-x-6 gap-y-4 overflow-x-auto pb-3">
            {PIPELINE_AGENTS.map((agent) => (
              <span key={agent.name} className="group relative inline-flex cursor-default select-none flex-col items-center gap-2 shrink-0 min-w-[72px]">
                <span className="text-2xl md:text-3xl leading-none transition-transform duration-150 ease-out group-hover:scale-105" aria-hidden="true">{agent.emoji}</span>
                <span className="text-[11px] md:text-[12px] font-semibold tracking-wide text-[var(--color-bright)] text-center">{agent.name}</span>
                <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-40 -translate-x-1/2 border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-center text-[10px] leading-relaxed text-[var(--color-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  {agent.desc}
                </span>
              </span>
            ))}
          </div>
        </div>

        <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed max-w-4xl mx-auto text-center mt-12">
          {t('hero_desc')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
          <Link
            href="/download"
            className="px-6 py-3 text-[12px] font-bold tracking-wider no-underline transition-all"
            style={{ background: 'var(--color-green)', color: '#060608' }}
          >
            {t('hero_cta')}
          </Link>
          <Link
            href="/project"
            className="px-6 py-3 text-[12px] font-semibold tracking-wider no-underline transition-all border border-[var(--color-border)] text-[var(--color-bright)] hover:border-[var(--color-muted)] hover:underline"
          >
            <span className="inline-flex items-center gap-2">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current">
                <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49C4 14.09 3.48 13.22 3.32 12.77c-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              <span>{t('hero_project_cta')}</span>
            </span>
          </Link>
        </div>
      </div>
    </section>
  )
}
