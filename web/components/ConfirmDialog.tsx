'use client'

import { useEffect, useRef } from 'react'

export type ConfirmDialogVariant = 'danger' | 'warning' | 'info'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmDialogVariant
  onConfirm: () => void
  onCancel: () => void
}

const VARIANT_CONFIG: Record<ConfirmDialogVariant, { icon: string; confirmBg: string; confirmColor: string; confirmBorder: string }> = {
  danger:  { icon: '⚠️', confirmBg: 'var(--color-red)',   confirmColor: '#fff', confirmBorder: 'var(--color-red)' },
  warning: { icon: '⚠️', confirmBg: '#d97706',            confirmColor: '#fff', confirmBorder: '#d97706' },
  info:    { icon: 'ℹ️', confirmBg: 'var(--color-green)', confirmColor: '#000', confirmBorder: 'var(--color-green)' },
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Conferma',
  cancelLabel  = 'Annulla',
  variant = 'info',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef  = useRef<HTMLDivElement>(null)
  const cancelRef  = useRef<HTMLButtonElement>(null)
  const cfg = VARIANT_CONFIG[variant]

  // Focus trap + Escape
  useEffect(() => {
    if (!open) return
    // Focus iniziale sul bottone Annulla (più sicuro per azioni distruttive)
    cancelRef.current?.focus()

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => !el.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  // Blocca scroll body
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        animation: 'fade-in 0.15s ease both',
        backdropFilter: 'blur(2px)',
      }}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        style={{
          background: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: '24px 24px 20px',
          maxWidth: 400, width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          animation: 'slide-up 0.18s ease both',
        }}>
        {/* Icona + Titolo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>{cfg.icon}</span>
          <h2 id="confirm-title" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-bright)' }}>
            {title}
          </h2>
        </div>

        {/* Messaggio */}
        <p id="confirm-message" style={{ margin: '0 0 20px', fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.5 }}>
          {message}
        </p>

        {/* Azioni */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              padding: '7px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'transparent', color: 'var(--color-muted)',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-row)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '7px 16px', fontSize: 12, fontWeight: 700, borderRadius: 8,
              border: `1px solid ${cfg.confirmBorder}`,
              background: cfg.confirmBg, color: cfg.confirmColor,
              cursor: 'pointer', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
