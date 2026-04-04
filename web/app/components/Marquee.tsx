'use client'

import { useRef, useEffect, useState, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface MarqueeProps {
  children:      ReactNode
  speed?:        number        // px/s, default 60
  direction?:    'left' | 'right'
  pauseOnHover?: boolean
  gap?:          number        // px tra le copie, default 48
  className?:    string
  style?:        React.CSSProperties
}

// ── Marquee ────────────────────────────────────────────────────────────────

export function Marquee({
  children,
  speed = 60,
  direction = 'left',
  pauseOnHover = true,
  gap = 48,
  className = '',
  style,
}: MarqueeProps) {
  const contentRef  = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(10)
  const [paused, setPaused]     = useState(false)

  // Calcola durata in base alla larghezza del contenuto
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const w = el.scrollWidth + gap
    setDuration(w / speed)
  }, [speed, gap, children])

  const translateDir = direction === 'left' ? '-50%' : '0%'
  const fromDir      = direction === 'left' ? '0%'   : '-50%'

  const keyframes = `
    @keyframes marquee-scroll {
      from { transform: translateX(${fromDir}); }
      to   { transform: translateX(${translateDir}); }
    }
  `

  return (
    <>
      <style>{keyframes}</style>
      <div
        className={`overflow-hidden ${className}`}
        style={{ position: 'relative', ...style }}
        onMouseEnter={pauseOnHover ? () => setPaused(true)  : undefined}
        onMouseLeave={pauseOnHover ? () => setPaused(false) : undefined}
      >
        <div
          style={{
            display: 'flex',
            width: 'max-content',
            animation: `marquee-scroll ${duration}s linear infinite`,
            animationPlayState: paused ? 'paused' : 'running',
            willChange: 'transform',
          }}
        >
          {/* Due copie per loop continuo */}
          <div ref={contentRef} style={{ display: 'flex', alignItems: 'center', paddingRight: gap }}>
            {children}
          </div>
          <div aria-hidden style={{ display: 'flex', alignItems: 'center', paddingRight: gap }}>
            {children}
          </div>
        </div>
      </div>
    </>
  )
}

// ── MarqueeItem ────────────────────────────────────────────────────────────

export interface MarqueeItemProps {
  children:   ReactNode
  separator?: ReactNode   // default •
  className?: string
}

export function MarqueeItem({ children, separator = '•', className = '' }: MarqueeItemProps) {
  return (
    <span
      className={`flex items-center gap-3 ${className}`}
      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-dim)', whiteSpace: 'nowrap' }}
    >
      {children}
      <span style={{ color: 'var(--color-border)', fontSize: 8, margin: '0 4px' }}>{separator}</span>
    </span>
  )
}

// ── NewsTicker ─────────────────────────────────────────────────────────────

export interface NewsTickerProps {
  items:         string[]
  label?:        string
  speed?:        number
  pauseOnHover?: boolean
  className?:    string
}

export function NewsTicker({ items, label = 'LIVE', speed = 50, pauseOnHover = true, className = '' }: NewsTickerProps) {
  return (
    <div
      className={`flex items-stretch overflow-hidden ${className}`}
      style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: 6 }}
    >
      {/* Badge etichetta */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', background: 'var(--color-green)', flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#000', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>
          {label}
        </span>
      </div>

      {/* Ticker scorrevole */}
      <Marquee speed={speed} pauseOnHover={pauseOnHover} style={{ flex: 1, padding: '4px 0' }}>
        {items.map((item, i) => (
          <MarqueeItem key={i}>{item}</MarqueeItem>
        ))}
      </Marquee>
    </div>
  )
}
