'use client'

import Link from 'next/link'
import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react'

type AgentDef = {
  emoji: string
  role: string
  color: string
  link: string | null
}

const CAPITANO: AgentDef = { emoji: '👨‍✈️', role: 'Capitano', color: '#ff9100', link: '/capitano' }

const PIPELINE: AgentDef[] = [
  { emoji: '🕵️', role: 'Scout', color: '#2196f3', link: '/scout' },
  { emoji: '👨‍🔬', role: 'Analista', color: '#00e676', link: '/analista' },
  { emoji: '👨‍💻', role: 'Scorer', color: '#b388ff', link: '/scorer' },
  { emoji: '👨‍🏫', role: 'Scrittore', color: '#ffd600', link: '/scrittore' },
  { emoji: '👨‍⚖️', role: 'Critico', color: '#f44336', link: '/critico' },
]

const SENTINELLA: AgentDef = { emoji: '💂', role: 'Sentinella', color: '#607d8b', link: null }

function AgentNode({ agent, size = 'md' }: { agent: AgentDef; size?: 'lg' | 'md' | 'sm' }) {
  const sizeClass = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-xl' : 'text-2xl'
  const node = (
    <div className="text-center group">
      <div className={`${sizeClass} leading-none mb-1.5 transition-transform group-hover:scale-110`}>{agent.emoji}</div>
      <div className="text-[10px] font-semibold tracking-wide" style={{ color: agent.color }}>{agent.role}</div>
    </div>
  )
  if (agent.link) {
    return <Link href={agent.link} className="no-underline block hover:opacity-80 transition-opacity">{node}</Link>
  }
  return node
}

export default function TeamPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const capRef = useRef<HTMLDivElement>(null)
  const pipeRefs = useRef<(HTMLDivElement | null)[]>(new Array(PIPELINE.length).fill(null))
  const sentRef = useRef<HTMLDivElement>(null)
  const [svgData, setSvgData] = useState<{ w: number; h: number; lines: ReactNode[] } | null>(null)

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

    // Defs: arrow markers e gradienti
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

    // Linee dal Capitano a ogni agente della pipeline (tratteggiate, arancione)
    const capCx = capR.x + capR.w / 2
    const capBy = capR.y + capR.h + 2

    pRects.forEach((pr, i) => {
      const px = pr!.x + pr!.w / 2
      const py = pr!.y - 2
      lines.push(
        <line
          key={`cap-${i}`}
          x1={capCx} y1={capBy}
          x2={px} y2={py}
          stroke="#ff9100"
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.35"
        />
      )
    })

    // Frecce orizzontali tra nodi pipeline (sinistra → destra)
    for (let i = 0; i < PIPELINE.length - 1; i++) {
      const from = pRects[i]!
      const to = pRects[i + 1]!
      const y = from.y + from.h / 2
      const x1 = from.x + from.w + 4
      const x2 = to.x - 4

      lines.push(
        <line
          key={`pipe-${i}`}
          x1={x1} y1={y}
          x2={x2} y2={y}
          stroke={`url(#pg-${i})`}
          strokeWidth="2"
          markerEnd="url(#arrowRight)"
        />
      )
    }

    // Feedback tratteggiato: Critico → Scrittore (arco sotto)
    const scrittore = pRects[3]!
    const critico = pRects[4]!
    const fbY = critico.y + critico.h + 16
    const fbX1 = critico.x + critico.w / 2
    const fbX2 = scrittore.x + scrittore.w / 2

    lines.push(
      <path
        key="feedback"
        d={`M ${fbX1} ${critico.y + critico.h + 2} V ${fbY} H ${fbX2} V ${scrittore.y + scrittore.h + 2}`}
        stroke="#f44336"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        fill="none"
        opacity="0.5"
      />
    )
    lines.push(
      <text
        key="fb-lbl"
        x={(fbX1 + fbX2) / 2}
        y={fbY + 12}
        fontSize="9"
        fill="#f44336"
        fontFamily="ui-monospace, monospace"
        textAnchor="middle"
        opacity="0.7"
      >
        feedback
      </text>
    )

    // Sentinella: linee tratteggiate verso tutti i nodi pipeline
    const sentR = getR(sentRef.current)
    if (sentR) {
      const sx = sentR.x + sentR.w / 2
      const sy = sentR.y + sentR.h

      pRects.forEach((pr, i) => {
        const px = pr!.x + pr!.w / 2
        const py = pr!.y
        lines.push(
          <line
            key={`sent-${i}`}
            x1={sx} y1={sy}
            x2={px} y2={py}
            stroke="#607d8b"
            strokeWidth="1"
            strokeDasharray="2 4"
            opacity="0.18"
          />
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

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Team</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Job Hunter Team</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">Pipeline e comunicazione tra agenti</p>
        </div>
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
            <AgentNode agent={CAPITANO} size="lg" />
          </div>
          <div ref={sentRef}>
            <AgentNode agent={SENTINELLA} size="md" />
          </div>
        </div>

        {/* Pipeline row — left to right */}
        <div className="flex items-center justify-center gap-16">
          {PIPELINE.map((agent, i) => (
            <div
              key={agent.role}
              ref={el => { pipeRefs.current[i] = el }}
            >
              <AgentNode agent={agent} />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: vertical flow */}
      <div className="sm:hidden flex flex-col items-center gap-4">
        <div className="flex items-end gap-6">
          <AgentNode agent={CAPITANO} size="lg" />
          <AgentNode agent={SENTINELLA} size="md" />
        </div>
        <div className="text-[var(--color-dim)] text-xs opacity-50">▼</div>
        {PIPELINE.map((agent, i) => (
          <div key={agent.role} className="flex flex-col items-center">
            <AgentNode agent={agent} />
            {i < PIPELINE.length - 1 && (
              <div className="text-[var(--color-dim)] text-xs opacity-50 my-2">→</div>
            )}
          </div>
        ))}
      </div>

    </div>
  )
}
