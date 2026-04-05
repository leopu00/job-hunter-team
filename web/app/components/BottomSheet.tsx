'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type SnapPoint = 0.25 | 0.5 | 1

export interface BottomSheetProps {
  open:          boolean
  onClose:       () => void
  children:      ReactNode
  snapPoints?:   SnapPoint[]
  defaultSnap?:  SnapPoint
  title?:        string
  hideHandle?:   boolean
  backdropDismiss?: boolean
  className?:    string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function nearest(target: number, points: SnapPoint[]): SnapPoint {
  return points.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a)
}

const ANIM = `
@keyframes bs-in  { from { transform: translateY(100%) } to { transform: translateY(0%) } }
@keyframes bs-out { from { transform: translateY(0%)   } to { transform: translateY(100%) } }
`

// ── BottomSheet ────────────────────────────────────────────────────────────

export function BottomSheet({
  open, onClose, children, title,
  snapPoints = [0.25, 0.5, 1],
  defaultSnap = 0.5,
  hideHandle = false,
  backdropDismiss = true,
  className = '',
}: BottomSheetProps) {
  const [snap, setSnap]     = useState<SnapPoint>(defaultSnap)
  const [dragging, setDrag] = useState(false)
  const [dy, setDy]         = useState(0)        // delta drag in corso
  const [closing, setClosing] = useState(false)
  const startY  = useRef(0)
  const sheetH  = useRef(0)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Reset snap quando si apre
  useEffect(() => {
    if (open) { setSnap(defaultSnap); setDy(0); setClosing(false) }
  }, [open, defaultSnap])

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const close = useCallback(() => {
    setClosing(true)
    setTimeout(() => { setClosing(false); onClose() }, 280)
  }, [onClose])

  // ESC chiude
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, close])

  const onDragStart = (clientY: number) => {
    startY.current = clientY
    sheetH.current = sheetRef.current?.offsetHeight ?? window.innerHeight
    setDrag(true)
    setDy(0)
  }

  const onDragMove = useCallback((clientY: number) => {
    if (!dragging) return
    setDy(Math.max(0, clientY - startY.current))
  }, [dragging])

  const onDragEnd = useCallback(() => {
    if (!dragging) return
    setDrag(false)
    const vh = window.innerHeight
    const currentH = sheetH.current - dy
    const fraction = currentH / vh
    if (fraction < snapPoints[0] - 0.1) { close(); setDy(0); return }
    const next = nearest(fraction, snapPoints)
    setSnap(next)
    setDy(0)
  }, [dragging, dy, snapPoints, close])

  useEffect(() => {
    if (!dragging) return
    const mm = (e: MouseEvent)  => onDragMove(e.clientY)
    const tm = (e: TouchEvent)  => onDragMove(e.touches[0].clientY)
    const mu = () => onDragEnd()
    document.addEventListener('mousemove', mm)
    document.addEventListener('mouseup',   mu)
    document.addEventListener('touchmove', tm, { passive: true })
    document.addEventListener('touchend',  mu)
    return () => {
      document.removeEventListener('mousemove', mm)
      document.removeEventListener('mouseup',   mu)
      document.removeEventListener('touchmove', tm)
      document.removeEventListener('touchend',  mu)
    }
  }, [dragging, onDragMove, onDragEnd])

  if (!open && !closing) return null

  const height     = `${snap * 100}vh`
  const translateY = dragging ? `${dy}px` : '0px'
  const animation  = closing ? 'bs-out 0.28s ease forwards' : 'bs-in 0.28s ease'

  return (
    <>
      <style>{ANIM}</style>

      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.55)', animation: closing ? 'none' : undefined,
          opacity: closing ? 0 : 1, transition: closing ? 'opacity .28s' : undefined }}
        onClick={backdropDismiss ? close : undefined}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Bottom sheet'}
        className={`flex flex-col ${className}`}
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 41,
          height, maxHeight: '100vh',
          background: 'var(--color-card)', borderRadius: '14px 14px 0 0',
          border: '1px solid var(--color-border)', borderBottom: 'none',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
          animation, transform: `translateY(${translateY})`,
          transition: dragging ? 'none' : 'height .25s ease',
          willChange: 'transform, height',
        }}>

        {/* Handle */}
        {!hideHandle && (
          <div
            style={{ padding: '10px 0 4px', display: 'flex', justifyContent: 'center',
              flexShrink: 0, cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
            onMouseDown={e => onDragStart(e.clientY)}
            onTouchStart={e => onDragStart(e.touches[0].clientY)}>
            <div aria-hidden="true" style={{ width: 36, height: 4, borderRadius: 2,
              background: 'var(--color-border)' }} />
          </div>
        )}

        {/* Title */}
        {title && (
          <div style={{ padding: '6px 16px 10px', flexShrink: 0,
            borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-bright)',
              fontFamily: 'var(--font-mono)' }}>{title}</span>
          </div>
        )}

        {/* Snap tabs */}
        {snapPoints.length > 1 && (
          <div style={{ display: 'flex', gap: 4, padding: '6px 16px 0', flexShrink: 0, justifyContent: 'center' }}>
            {snapPoints.map(s => (
              <button key={s} onClick={() => setSnap(s)} type="button"
                style={{ fontSize: 8, padding: '2px 8px', borderRadius: 99, cursor: 'pointer',
                  background: snap === s ? 'var(--color-green)' : 'var(--color-row)',
                  border: `1px solid ${snap === s ? 'var(--color-green)' : 'var(--color-border)'}`,
                  color: snap === s ? '#000' : 'var(--color-dim)',
                  fontFamily: 'var(--font-mono)', fontWeight: snap === s ? 700 : 400 }}>
                {Math.round(s * 100)}%
              </button>
            ))}
          </div>
        )}

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px',
          overscrollBehavior: 'contain' }}>
          {children}
        </div>
      </div>
    </>
  )
}

// ── useBottomSheet ─────────────────────────────────────────────────────────

export function useBottomSheet() {
  const [open, setOpen] = useState(false)
  return { open, show: () => setOpen(true), hide: () => setOpen(false) }
}
