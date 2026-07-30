'use client'

import { useCallback, useEffect, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TourStep {
  target:    string       // CSS selector dell'elemento da evidenziare
  title:     string
  content:   string
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

export interface OnboardingTourProps {
  steps:       TourStep[]
  active:      boolean
  onComplete?: () => void
  onSkip?:     () => void
}

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 8   // padding spotlight
const GAP = 12  // gap tooltip ↔ target

// ── Tooltip placement ──────────────────────────────────────────────────────

function tooltipPos(rect: Rect, placement: TourStep['placement'] = 'bottom', tw: number, th: number) {
  const p = placement
  if (p === 'bottom') return { top: rect.top + rect.height + GAP,           left: rect.left + rect.width / 2 - tw / 2 }
  if (p === 'top')    return { top: rect.top - th - GAP,                    left: rect.left + rect.width / 2 - tw / 2 }
  if (p === 'right')  return { top: rect.top + rect.height / 2 - th / 2,   left: rect.left + rect.width  + GAP       }
                      return { top: rect.top + rect.height / 2 - th / 2,   left: rect.left - tw - GAP                }
}

// ── OnboardingTour ─────────────────────────────────────────────────────────

export function OnboardingTour({ steps, active, onComplete, onSkip }: OnboardingTourProps) {
  const [idx, setIdx]   = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  const step = steps[idx]

  const measure = useCallback(() => {
    if (!step) return
    const el = document.querySelector(step.target)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    setRect({ top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height })
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [step])

  useEffect(() => {
    if (!active) return
    setIdx(0)
  }, [active])

  useEffect(() => {
    if (!active) return
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active, measure])

  const next = () => {
    if (idx >= steps.length - 1) { onComplete?.(); return }
    setIdx(i => i + 1)
  }
  const prev = () => { if (idx > 0) setIdx(i => i - 1) }

  useEffect(() => { if (active) measure() }, [idx, active, measure])

  if (!active) return null

  const TW = 280, TH = 120   // tooltip approx size
  const tp = rect ? tooltipPos(rect, step.placement, TW, TH) : { top: window.innerHeight / 2 - 60, left: window.innerWidth / 2 - 140 }
  const sr = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
      {/* Overlay con buco spotlight via clip-path */}
      {sr ? (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) onSkip?.() }}>
          <defs>
            <mask id="tour-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect x={sr.left} y={sr.top} width={sr.width} height={sr.height} rx={6} fill="black" />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#tour-mask)" />
          {/* Border spotlight */}
          <rect x={sr.left} y={sr.top} width={sr.width} height={sr.height} rx={6}
            fill="none" stroke="var(--color-green)" strokeWidth="2" opacity="0.8" />
        </svg>
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', pointerEvents: 'auto' }}
          onClick={onSkip} />
      )}

      {/* Tooltip */}
      <div role="dialog" aria-label={step.title}
        style={{ position: 'absolute', top: tp.top, left: tp.left, width: TW,
        background: 'var(--color-card)', border: '1px solid var(--color-border)',
        borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', pointerEvents: 'auto',
        animation: 'tour-pop 0.2s ease' }}>

        <style>{`@keyframes tour-pop { from { opacity:0; transform:scale(.95) } to { opacity:1; transform:scale(1) } }`}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px 6px', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-bright)', fontFamily: 'var(--font-mono)' }}>
            {step.title}
          </span>
          <button onClick={onSkip} style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-dim)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
            title="Salta tour">✕</button>
        </div>

        {/* Body */}
        <p style={{ margin: 0, padding: '8px 12px', fontSize: 10, color: 'var(--color-base)',
          fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
          {step.content}
        </p>

        {/* Footer nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px 10px' }}>
          {/* Dots */}
          <div style={{ display: 'flex', gap: 4 }}>
            {steps.map((_, i) => (
              <div key={i} style={{ width: i === idx ? 14 : 5, height: 5, borderRadius: 3,
                background: i < idx ? 'var(--color-green)' : i === idx ? 'var(--color-green)' : 'var(--color-border)',
                opacity: i === idx ? 1 : i < idx ? 0.6 : 0.4, transition: 'all .2s' }} />
            ))}
          </div>
          {/* Buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            {idx > 0 && (
              <button onClick={prev} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-muted)',
                fontFamily: 'var(--font-mono)' }}>
                ←
              </button>
            )}
            <button onClick={next} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
              background: 'var(--color-green)', border: 'none', color: '#000', fontWeight: 700,
              fontFamily: 'var(--font-mono)' }}>
              {idx === steps.length - 1 ? 'Fine' : 'Avanti →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── useOnboardingTour ──────────────────────────────────────────────────────

export function useOnboardingTour(storageKey?: string) {
  const seen = storageKey ? localStorage.getItem(storageKey) === '1' : false
  const [active, setActive] = useState(!seen)
  const start    = () => setActive(true)
  const complete = () => { if (storageKey) localStorage.setItem(storageKey, '1'); setActive(false) }
  const skip     = complete
  return { active, start, complete, skip }
}
