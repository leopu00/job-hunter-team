'use client'

import { Children, useCallback, useEffect, useRef, useState } from 'react'

export interface CarouselProps {
  children: React.ReactNode
  autoPlay?: boolean
  interval?: number
  showDots?: boolean
  showArrows?: boolean
  infinite?: boolean
  /** Quante slide visibili contemporaneamente (1-4) */
  slidesPerView?: number
  className?: string
}

export default function Carousel({
  children,
  autoPlay = false,
  interval = 3000,
  showDots = true,
  showArrows = true,
  infinite = true,
  slidesPerView = 1,
  className,
}: CarouselProps) {
  const slides     = Children.toArray(children)
  const total      = slides.length
  const [current, setCurrent] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [animated, setAnimated] = useState(true)
  const touchStart = useRef<number | null>(null)
  const touchDelta = useRef(0)
  const autoRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const trackRef   = useRef<HTMLDivElement>(null)

  const clamp = useCallback((n: number) => {
    if (infinite) return ((n % total) + total) % total
    return Math.max(0, Math.min(total - slidesPerView, n))
  }, [infinite, total, slidesPerView])

  const goTo = useCallback((n: number) => {
    setCurrent(clamp(n))
    setAnimated(true)
  }, [clamp])

  const prev = useCallback(() => goTo(current - 1), [current, goTo])
  const next = useCallback(() => goTo(current + 1), [current, goTo])

  /* ── AutoPlay ── */
  useEffect(() => {
    if (!autoPlay || total <= 1) return
    autoRef.current = setInterval(next, interval)
    return () => { if (autoRef.current) clearInterval(autoRef.current) }
  }, [autoPlay, interval, next, total])

  const resetAuto = () => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null }
    if (autoPlay) autoRef.current = setInterval(next, interval)
  }

  /* ── Touch / swipe ── */
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = e.touches[0].clientX
    touchDelta.current = 0
    setDragging(false)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStart.current === null) return
    touchDelta.current = e.touches[0].clientX - touchStart.current
    if (Math.abs(touchDelta.current) > 5) setDragging(true)
  }
  const onTouchEnd = () => {
    if (Math.abs(touchDelta.current) > 40) {
      touchDelta.current < 0 ? next() : prev()
      resetAuto()
    }
    touchStart.current = null; setDragging(false)
  }

  /* ── Mouse drag (desktop) ── */
  const mouseStart = useRef<number | null>(null)
  const onMouseDown = (e: React.MouseEvent) => { mouseStart.current = e.clientX }
  const onMouseUp   = (e: React.MouseEvent) => {
    if (mouseStart.current === null) return
    const delta = e.clientX - mouseStart.current
    if (Math.abs(delta) > 40) { delta < 0 ? next() : prev(); resetAuto() }
    mouseStart.current = null
  }

  const slideW = 100 / slidesPerView
  const translateX = -(current * slideW)

  const atStart = !infinite && current === 0
  const atEnd   = !infinite && current >= total - slidesPerView

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', userSelect: 'none' }}>
      {/* Track */}
      <div
        ref={trackRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        style={{
          display: 'flex',
          transform: `translateX(${translateX}%)`,
          transition: animated && !dragging ? 'transform 0.35s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none',
          cursor: dragging ? 'grabbing' : 'grab',
        }}>
        {slides.map((slide, i) => (
          <div key={i} style={{ flexShrink: 0, width: `${slideW}%`, boxSizing: 'border-box' }}>
            {slide}
          </div>
        ))}
      </div>

      {/* Arrows */}
      {showArrows && total > 1 && (
        <>
          {[{ dir: 'prev', label: '‹', disabled: atStart, action: prev }, { dir: 'next', label: '›', disabled: atEnd, action: next }].map(({ dir, label, disabled, action }) => (
            <button key={dir} onClick={() => { action(); resetAuto() }} disabled={disabled}
              style={{
                position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                [dir === 'prev' ? 'left' : 'right']: 8,
                width: 32, height: 32, borderRadius: '50%',
                border: '1px solid var(--color-border)',
                background: 'var(--color-panel)',
                color: disabled ? 'var(--color-border)' : 'var(--color-muted)',
                fontSize: 18, cursor: disabled ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 2, transition: 'background 0.15s',
                opacity: disabled ? 0.4 : 0.9,
              }}>
              {label}
            </button>
          ))}
        </>
      )}

      {/* Dots */}
      {showDots && total > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginTop: 10 }}>
          {slides.map((_, i) => (
            <button key={i} onClick={() => { goTo(i); resetAuto() }}
              style={{
                width: i === current ? 16 : 6, height: 6, borderRadius: 3, border: 'none',
                background: i === current ? 'var(--color-green)' : 'var(--color-border)',
                cursor: 'pointer', padding: 0,
                transition: 'width 0.2s ease, background 0.2s ease',
              }} />
          ))}
        </div>
      )}
    </div>
  )
}
