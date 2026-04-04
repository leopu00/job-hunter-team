'use client'

import { useEffect, useRef, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type DrawerPosition = 'left' | 'right'
export type DrawerSize     = 'sm' | 'md' | 'lg' | 'full'

export interface DrawerProps {
  open:      boolean
  onClose:   () => void
  title?:    string
  children?: ReactNode
  footer?:   ReactNode
  position?: DrawerPosition
  size?:     DrawerSize
}

// ── Size map ───────────────────────────────────────────────────────────────

const SIZE_W: Record<DrawerSize, string> = {
  sm:   '320px',
  md:   '420px',
  lg:   '560px',
  full: '100vw',
}

// ── Focus trap ─────────────────────────────────────────────────────────────

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return
    const el = ref.current
    const focusable = () => Array.from(el.querySelectorAll<HTMLElement>(
      'button,a,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    )).filter(e => !e.hasAttribute('disabled'))

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus() } }
      else            { if (document.activeElement === last)  { e.preventDefault(); first.focus() } }
    }

    el.addEventListener('keydown', onKey)
    focusable()[0]?.focus()
    return () => el.removeEventListener('keydown', onKey)
  }, [active, ref])
}

// ── Drawer ─────────────────────────────────────────────────────────────────

export function Drawer({
  open, onClose, title, children, footer,
  position = 'right', size = 'md',
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, open)

  // Scroll lock + ESC
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open) return null

  const fromRight = position === 'right'
  const w = SIZE_W[size]

  return (
    <>
      <style>{`
        @keyframes drawer-slide-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes drawer-slide-left  { from { transform: translateX(-100%); } to { transform: translateX(0); } }
        @keyframes drawer-overlay-in  { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Overlay */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 70, background: 'rgba(0,0,0,0.55)', animation: 'drawer-overlay-in 0.2s ease both' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 bottom-0 flex flex-col"
        style={{
          [position]: 0,
          width: w, maxWidth: '100vw',
          zIndex: 71,
          background: 'var(--color-deep)',
          borderLeft:  fromRight ? '1px solid var(--color-border)' : undefined,
          borderRight: !fromRight ? '1px solid var(--color-border)' : undefined,
          animation: `${fromRight ? 'drawer-slide-right' : 'drawer-slide-left'} 0.25s cubic-bezier(0.32,0.72,0,1) both`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          {title
            ? <p className="text-[13px] font-bold tracking-wide" style={{ color: 'var(--color-white)' }}>{title}</p>
            : <span />}
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded cursor-pointer bg-transparent border-0 transition-opacity hover:opacity-60"
            style={{ color: 'var(--color-dim)' }}
            aria-label="Chiudi"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 px-5 py-4"
            style={{ borderTop: '1px solid var(--color-border)', background: 'color-mix(in srgb, var(--color-void) 20%, transparent)' }}>
            {footer}
          </div>
        )}
      </div>
    </>
  )
}

// ── useDrawer — hook helper ────────────────────────────────────────────────

import { useState } from 'react'

export function useDrawer() {
  const [open, setOpen] = useState(false)
  return { open, onOpen: () => setOpen(true), onClose: () => setOpen(false) }
}
