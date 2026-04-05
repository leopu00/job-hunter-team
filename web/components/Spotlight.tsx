'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface SpotlightStep {
  /** CSS selector o ref — usato per trovare l'elemento da evidenziare */
  target?: string
  title: string
  description?: string
  /** Posizione tooltip rispetto al target */
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

export interface SpotlightProps {
  steps: SpotlightStep[]
  active: boolean
  onFinish: () => void
  onSkip?: () => void
  padding?: number
}

interface Rect { top: number; left: number; width: number; height: number }

const TOOLTIP_W = 280
const TOOLTIP_H = 140
const GAP       = 12

function getPlacement(rect: Rect, placement: SpotlightStep['placement'] = 'bottom'): React.CSSProperties {
  const vw = window.innerWidth; const vh = window.innerHeight
  const pos: Record<string, React.CSSProperties> = {
    bottom: { top: rect.top + rect.height + GAP, left: Math.min(Math.max(rect.left + rect.width / 2 - TOOLTIP_W / 2, 8), vw - TOOLTIP_W - 8) },
    top:    { top: rect.top - TOOLTIP_H - GAP,   left: Math.min(Math.max(rect.left + rect.width / 2 - TOOLTIP_W / 2, 8), vw - TOOLTIP_W - 8) },
    right:  { top: Math.min(Math.max(rect.top + rect.height / 2 - TOOLTIP_H / 2, 8), vh - TOOLTIP_H - 8), left: rect.left + rect.width + GAP },
    left:   { top: Math.min(Math.max(rect.top + rect.height / 2 - TOOLTIP_H / 2, 8), vh - TOOLTIP_H - 8), left: rect.left - TOOLTIP_W - GAP },
  }
  // Auto-flip se fuori schermo
  let p = placement
  if (p === 'bottom' && rect.top + rect.height + TOOLTIP_H + GAP > vh) p = 'top'
  if (p === 'top'    && rect.top - TOOLTIP_H - GAP < 0)                p = 'bottom'
  if (p === 'right'  && rect.left + rect.width + TOOLTIP_W + GAP > vw) p = 'left'
  if (p === 'left'   && rect.left - TOOLTIP_W - GAP < 0)               p = 'right'
  return { ...pos[p], position: 'fixed', width: TOOLTIP_W }
}

export default function Spotlight({ steps, active, onFinish, onSkip, padding = 8 }: SpotlightProps) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const step = steps[currentIdx]

  const measureTarget = useCallback(() => {
    if (!step?.target) { setTargetRect(null); return }
    const el = document.querySelector(step.target)
    if (!el) { setTargetRect(null); return }
    const r = el.getBoundingClientRect()
    setTargetRect({ top: r.top - padding, left: r.left - padding, width: r.width + padding * 2, height: r.height + padding * 2 })
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [step?.target, padding])

  useEffect(() => {
    if (!active) return
    measureTarget()
    window.addEventListener('resize', measureTarget)
    window.addEventListener('scroll', measureTarget, true)
    return () => { window.removeEventListener('resize', measureTarget); window.removeEventListener('scroll', measureTarget, true) }
  }, [active, measureTarget])

  useEffect(() => { if (active) tooltipRef.current?.focus() }, [active, currentIdx])

  const next = () => {
    if (currentIdx < steps.length - 1) setCurrentIdx(i => i + 1)
    else { setCurrentIdx(0); onFinish() }
  }
  const prev = () => { if (currentIdx > 0) setCurrentIdx(i => i - 1) }
  const skip = () => { setCurrentIdx(0); onSkip?.() ?? onFinish() }

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!active) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'Escape') skip()
    }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [active, currentIdx])

  if (!active || !step) return null

  const tooltipStyle = targetRect ? getPlacement(targetRect, step.placement) : { position: 'fixed' as const, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: TOOLTIP_W }

  /* ── SVG overlay con buco sul target ── */
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const r  = targetRect

  const cutout = r
    ? `M0,0 H${vw} V${vh} H0 Z M${r.left + 6},${r.top + 6} h${r.width - 12} q6,0 6,6 v${r.height - 12} q0,6 -6,6 h${r.width - 12} q-6,0 -6,-6 v${r.height - 12} q0,-6 6,-6 Z`
    : `M0,0 H${vw} V${vh} H0 Z`

  return (
    <>
      {/* Overlay SVG con buco */}
      <svg style={{ position: 'fixed', inset: 0, zIndex: 9000, pointerEvents: 'none' }} width={vw} height={vh} aria-hidden="true">
        <path d={cutout} fill="rgba(0,0,0,0.65)" fillRule="evenodd" />
        {r && <rect x={r.left} y={r.top} width={r.width} height={r.height} fill="none" stroke="var(--color-green)" strokeWidth={2} rx={6} />}
      </svg>

      {/* Click overlay per bloccare interazioni dietro */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 8999 }} onClick={skip} />

      {/* Tooltip */}
      <div ref={tooltipRef} tabIndex={-1} style={{ ...tooltipStyle, zIndex: 9001, background: 'var(--color-panel)', border: '1px solid var(--color-green)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', outline: 'none', animation: 'slide-up 0.18s ease both' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-bright)', flex: 1 }}>{step.title}</span>
          <span style={{ fontSize: 9, color: 'var(--color-dim)', flexShrink: 0, marginLeft: 8 }}>{currentIdx + 1} / {steps.length}</span>
        </div>
        {step.description && <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--color-muted)', lineHeight: 1.5 }}>{step.description}</p>}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={skip} style={{ fontSize: 10, background: 'none', border: 'none', color: 'var(--color-dim)', cursor: 'pointer', padding: 0 }}>Salta</button>
          <div style={{ display: 'flex', gap: 6 }}>
            {currentIdx > 0 && <button onClick={prev} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }}>← Indietro</button>}
            <button onClick={next} style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--color-green)', color: '#000', fontWeight: 700, cursor: 'pointer' }}>
              {currentIdx === steps.length - 1 ? 'Fine ✓' : 'Avanti →'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
