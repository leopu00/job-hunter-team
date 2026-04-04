'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScrollToTopProps {
  threshold?:   number           // px di scroll prima che appaia, default 300
  scrollTarget?: string | Window // CSS selector o window, default window
  icon?:        ReactNode        // default freccia su SVG
  label?:       string           // tooltip aria-label
  position?:    'bottom-right' | 'bottom-left' | 'bottom-center'
  bottom?:      number           // px dal bottom, default 24
  size?:        number           // px bottone, default 40
  color?:       string           // colore, default --color-green
  smooth?:      boolean          // smooth scroll, default true
  className?:   string
}

// ── Helpers ────────────────────────────────────────────────────────────────

const ANIM = `
@keyframes stt-in  { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform: translateY(0) } }
@keyframes stt-out { from { opacity:1; transform: translateY(0)   } to { opacity:0; transform: translateY(8px) } }
`

const POS: Record<NonNullable<ScrollToTopProps['position']>, React.CSSProperties> = {
  'bottom-right':  { right:  24 },
  'bottom-left':   { left:   24 },
  'bottom-center': { left: '50%', transform: 'translateX(-50%)' },
}

const ArrowUp = ({ size }: { size: number }) => (
  <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7"/>
  </svg>
)

// ── ScrollToTop ────────────────────────────────────────────────────────────

export function ScrollToTop({
  threshold = 300,
  scrollTarget,
  icon,
  label = 'Torna in cima',
  position = 'bottom-right',
  bottom = 24,
  size = 40,
  color = 'var(--color-green)',
  smooth = true,
  className = '',
}: ScrollToTopProps) {
  const [visible, setVisible]   = useState(false)
  const [leaving, setLeaving]   = useState(false)
  const leaveTimer              = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Determina l'elemento scrollabile
  const getTarget = (): HTMLElement | Window => {
    if (!scrollTarget || scrollTarget === window) return window
    if (typeof scrollTarget === 'string') return document.querySelector(scrollTarget) as HTMLElement ?? window
    return scrollTarget
  }

  const getScrollY = (): number => {
    const t = getTarget()
    return t === window ? window.scrollY : (t as HTMLElement).scrollTop
  }

  useEffect(() => {
    const t = getTarget()
    const handler = () => {
      const y = getScrollY()
      if (y > threshold) {
        setLeaving(false)
        if (leaveTimer.current) clearTimeout(leaveTimer.current)
        setVisible(true)
      } else if (visible) {
        setLeaving(true)
        leaveTimer.current = setTimeout(() => { setVisible(false); setLeaving(false) }, 250)
      }
    }
    t.addEventListener('scroll', handler, { passive: true })
    return () => {
      t.removeEventListener('scroll', handler)
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    }
  }, [threshold, visible, scrollTarget]) // eslint-disable-line

  const scrollUp = () => {
    const t = getTarget()
    if (t === window) {
      window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'instant' as ScrollBehavior })
    } else {
      (t as HTMLElement).scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'instant' as ScrollBehavior })
    }
  }

  if (!visible) return <style>{ANIM}</style>

  return (
    <>
      <style>{ANIM}</style>
      <button
        type="button"
        onClick={scrollUp}
        aria-label={label}
        className={className}
        style={{
          position: 'fixed', bottom, zIndex: 49,
          ...POS[position],
          width: size, height: size, borderRadius: '50%',
          background: color, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#000', boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          animation: leaving ? 'stt-out .25s ease forwards' : 'stt-in .25s ease',
          transition: 'transform .15s, box-shadow .15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.transform =
            position === 'bottom-center' ? 'translateX(-50%) scale(1.1)' : 'scale(1.1)'
          ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.45)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform =
            position === 'bottom-center' ? 'translateX(-50%) scale(1)' : 'scale(1)'
          ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.35)'
        }}
      >
        {icon ?? <ArrowUp size={size} />}
      </button>
    </>
  )
}

// ── useScrollProgress ─── opzionale, utile per progress bar ───────────────

export function useScrollProgress(target?: string): number {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const el = target ? document.querySelector(target) as HTMLElement : null
    const src = el ?? window
    const calc = () => {
      const scrolled = el ? el.scrollTop : window.scrollY
      const total    = el ? el.scrollHeight - el.clientHeight : document.documentElement.scrollHeight - window.innerHeight
      setPct(total > 0 ? Math.min(100, (scrolled / total) * 100) : 0)
    }
    src.addEventListener('scroll', calc, { passive: true })
    return () => src.removeEventListener('scroll', calc)
  }, [target])
  return pct
}
