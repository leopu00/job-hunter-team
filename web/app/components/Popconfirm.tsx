'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type PopconfirmPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface PopconfirmProps {
  children:       React.ReactNode        // trigger element
  title:          string
  description?:   string
  onConfirm:      () => void
  onCancel?:      () => void
  confirmLabel?:  string
  cancelLabel?:   string
  placement?:     PopconfirmPlacement
  danger?:        boolean                // confirm button diventa rosso
  disabled?:      boolean
}

// ── Arrow + panel placement ────────────────────────────────────────────────

type PlacementStyle = { panel: React.CSSProperties; arrow: React.CSSProperties }

function getPlacementStyle(placement: PopconfirmPlacement, triggerRect: DOMRect): PlacementStyle {
  const GAP = 10
  const base: React.CSSProperties = { position: 'fixed', zIndex: 75 }

  if (placement === 'top') return {
    panel: { ...base, bottom: window.innerHeight - triggerRect.top + GAP, left: triggerRect.left + triggerRect.width / 2, transform: 'translateX(-50%)' },
    arrow: { bottom: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
  }
  if (placement === 'bottom') return {
    panel: { ...base, top: triggerRect.bottom + GAP, left: triggerRect.left + triggerRect.width / 2, transform: 'translateX(-50%)' },
    arrow: { top: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
  }
  if (placement === 'left') return {
    panel: { ...base, right: window.innerWidth - triggerRect.left + GAP, top: triggerRect.top + triggerRect.height / 2, transform: 'translateY(-50%)' },
    arrow: { right: -5, top: '50%', transform: 'translateY(-50%) rotate(45deg)' },
  }
  return { // right
    panel: { ...base, left: triggerRect.right + GAP, top: triggerRect.top + triggerRect.height / 2, transform: 'translateY(-50%)' },
    arrow: { left: -5, top: '50%', transform: 'translateY(-50%) rotate(45deg)' },
  }
}

// ── Popconfirm ─────────────────────────────────────────────────────────────

export function Popconfirm({
  children, title, description, onConfirm, onCancel,
  confirmLabel = 'Sì', cancelLabel = 'No',
  placement = 'top', danger = false, disabled = false,
}: PopconfirmProps) {
  const [open, setOpen]             = useState(false)
  const [style, setStyle]           = useState<PlacementStyle | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)

  const recalc = useCallback(() => {
    if (!triggerRef.current) return
    setStyle(getPlacementStyle(placement, triggerRef.current.getBoundingClientRect()))
  }, [placement])

  const openPanel = () => { if (disabled) return; recalc(); setOpen(true) }

  const close = useCallback(() => setOpen(false), [])

  const confirm = () => { close(); onConfirm() }
  const cancel  = () => { close(); onCancel?.() }

  // ESC + click outside
  useEffect(() => {
    if (!open) return
    const onKey   = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node))
        cancel()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open, cancel])

  const confirmStyle: React.CSSProperties = danger
    ? { background: 'var(--color-red)', color: '#fff', border: 'none' }
    : { background: 'var(--color-green)', color: '#000', border: 'none' }

  return (
    <>
      <style>{`@keyframes pcf-in { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }`}</style>

      {/* Trigger */}
      <span ref={triggerRef} onClick={openPanel} style={{ display: 'contents' }}>
        {children}
      </span>

      {/* Panel */}
      {open && style && (
        <div ref={panelRef}
          role="dialog" aria-modal="false" aria-label={title}
          style={{
            ...style.panel,
            width: 220,
            background: 'var(--color-deep)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            animation: 'pcf-in 0.15s ease both',
          }}>

          {/* Arrow */}
          <div style={{
            position: 'absolute', width: 10, height: 10,
            background: 'var(--color-deep)',
            border: '1px solid var(--color-border)',
            ...style.arrow,
          }} />

          {/* Content */}
          <div className="px-4 py-3 flex flex-col gap-3" style={{ position: 'relative' }}>
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] font-semibold leading-snug" style={{ color: 'var(--color-bright)' }}>{title}</p>
              {description && <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>{description}</p>}
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={cancel}
                className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                {cancelLabel}
              </button>
              <button onClick={confirm}
                className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-opacity hover:opacity-80"
                style={confirmStyle}>
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── usePopconfirm — controllo imperativo ───────────────────────────────────

export function usePopconfirm() {
  const [open, setOpen] = useState(false)
  return { open, show: () => setOpen(true), hide: () => setOpen(false) }
}
