'use client'

import { useEffect, useRef, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

export type ModalProps = {
  open:        boolean
  onClose:     () => void
  title?:      string
  size?:       ModalSize
  footer?:     ReactNode
  hideClose?:  boolean
  children:    ReactNode
  className?:  string
}

// ── Size map ───────────────────────────────────────────────────────────────

const SIZE_MAX: Record<ModalSize, string> = {
  sm:   '400px',
  md:   '540px',
  lg:   '700px',
  xl:   '900px',
  full: '95vw',
}

// ── Focus trap ─────────────────────────────────────────────────────────────

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return
    const el = ref.current
    const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE)
    const first = nodes[0]; const last = nodes[nodes.length - 1]
    first?.focus()

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (!nodes.length) { e.preventDefault(); return }
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus() } }
      else            { if (document.activeElement === last)  { e.preventDefault(); first?.focus() } }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [active, ref])
}

// ── Modal ──────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, size = 'md', footer, hideClose, children, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId   = `modal-title-${Math.random().toString(36).slice(2)}`

  // Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Scroll lock
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  useFocusTrap(dialogRef, open)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 9500, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', animation: 'modal-overlay 0.18s ease both' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`w-full flex flex-col rounded-xl overflow-hidden ${className ?? ''}`}
        style={{
          maxWidth:   SIZE_MAX[size],
          maxHeight:  size === 'full' ? '95vh' : '85vh',
          background: 'var(--color-panel)',
          border:     '1px solid var(--color-border)',
          boxShadow:  '0 24px 64px rgba(0,0,0,0.6)',
          animation:  'modal-in 0.2s ease both',
        }}>

        {/* Header */}
        {(title || !hideClose) && (
          <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
            style={{ borderColor: 'var(--color-border)' }}>
            {title
              ? <h2 id={titleId} className="text-[14px] font-bold" style={{ color: 'var(--color-white)' }}>{title}</h2>
              : <span />
            }
            {!hideClose && (
              <button onClick={onClose} aria-label="Chiudi"
                className="text-[18px] leading-none cursor-pointer transition-opacity hover:opacity-60 flex-shrink-0"
                style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}>×</button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 px-5 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
            {footer}
          </div>
        )}
      </div>

      <style>{`
        @keyframes modal-overlay { from { opacity: 0 } to { opacity: 1 } }
        @keyframes modal-in { from { opacity: 0; transform: scale(0.94) translateY(8px) } to { opacity: 1; transform: scale(1) translateY(0) } }
      `}</style>
    </div>
  )
}
