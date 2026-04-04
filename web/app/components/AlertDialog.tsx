'use client'

import { useEffect, useRef, type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type AlertVariant = 'danger' | 'warning' | 'info' | 'success'

export interface AlertDialogAction {
  label:     string
  onClick:   () => void
  loading?:  boolean
  disabled?: boolean
}

export interface AlertDialogProps {
  open:         boolean
  onClose:      () => void
  title:        string
  message:      ReactNode
  variant?:     AlertVariant
  icon?:        ReactNode     // override icona automatica
  primary?:     AlertDialogAction
  secondary?:   AlertDialogAction
  closeOnBackdrop?: boolean
  className?:   string
}

// ── Variant config ─────────────────────────────────────────────────────────

const V_CFG: Record<AlertVariant, { color: string; bg: string; border: string; icon: string }> = {
  danger:  { color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.1)',    border: 'rgba(255,69,96,0.3)',    icon: '⚠' },
  warning: { color: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.1)',   border: 'rgba(245,197,24,0.3)',   icon: '⚡' },
  info:    { color: 'var(--color-blue)',   bg: 'rgba(77,159,255,0.1)',   border: 'rgba(77,159,255,0.3)',   icon: 'ℹ' },
  success: { color: 'var(--color-green)',  bg: 'rgba(0,232,122,0.1)',    border: 'rgba(0,232,122,0.3)',    icon: '✓' },
}

// ── Focus trap ─────────────────────────────────────────────────────────────

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return
    const el  = ref.current
    const sel = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(sel))
    const first = () => focusables()[0]
    const last  = () => focusables().at(-1)
    first()?.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const fs = focusables()
      if (!fs.length) { e.preventDefault(); return }
      if (e.shiftKey) { if (document.activeElement === fs[0]) { e.preventDefault(); fs.at(-1)?.focus() } }
      else            { if (document.activeElement === fs.at(-1)) { e.preventDefault(); fs[0]?.focus() } }
    }
    el.addEventListener('keydown', trap)
    return () => el.removeEventListener('keydown', trap)
  }, [active, ref])
}

// ── Animations ─────────────────────────────────────────────────────────────

const ANIM = `
@keyframes ad-backdrop { from{opacity:0} to{opacity:1} }
@keyframes ad-in  { from{opacity:0;transform:scale(.94) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
`

// ── AlertDialog ────────────────────────────────────────────────────────────

export function AlertDialog({
  open, onClose, title, message, variant = 'info',
  icon, primary, secondary, closeOnBackdrop = true, className = '',
}: AlertDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const v = V_CFG[variant]

  useFocusTrap(dialogRef, open)

  // ESC chiude
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const primaryBg = variant === 'danger' ? 'var(--color-red)' :
                    variant === 'warning' ? 'var(--color-yellow)' :
                    variant === 'success' ? 'var(--color-green)' : 'var(--color-blue)'

  return (
    <>
      <style>{ANIM}</style>

      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.6)', animation: 'ad-backdrop .2s ease' }}
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div role="alertdialog" aria-modal="true" aria-labelledby="ad-title" aria-describedby="ad-msg"
        ref={dialogRef}
        className={className}
        style={{ position: 'fixed', inset: 0, zIndex: 61, display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '16px', pointerEvents: 'none' }}>
        <div style={{ width: '100%', maxWidth: 420, pointerEvents: 'auto',
          background: 'var(--color-card)', border: `1px solid ${v.border}`,
          borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          animation: 'ad-in .22s ease', overflow: 'hidden' }}>

          {/* Icon strip */}
          <div style={{ padding: '20px 20px 0', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0,
              background: v.bg, border: `1px solid ${v.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, color: v.color }}>
              {icon ?? v.icon}
            </div>
            <div style={{ flex: 1, paddingTop: 2 }}>
              <h2 id="ad-title" style={{ margin: 0, fontSize: 13, fontWeight: 700,
                color: 'var(--color-bright)', fontFamily: 'var(--font-mono)' }}>
                {title}
              </h2>
              <div id="ad-msg" style={{ marginTop: 6, fontSize: 11,
                color: 'var(--color-base)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
                {message}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '16px 20px 20px' }}>
            {secondary && (
              <button type="button" onClick={secondary.onClick} disabled={secondary.disabled}
                style={{ padding: '7px 16px', borderRadius: 6, cursor: secondary.disabled ? 'not-allowed' : 'pointer',
                  background: 'transparent', border: '1px solid var(--color-border)',
                  color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 11,
                  opacity: secondary.disabled ? 0.5 : 1, transition: 'border-color .15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-muted)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)' }}>
                {secondary.label}
              </button>
            )}
            {primary && (
              <button type="button" onClick={primary.onClick} disabled={primary.disabled || primary.loading}
                style={{ padding: '7px 16px', borderRadius: 6,
                  cursor: primary.disabled || primary.loading ? 'not-allowed' : 'pointer',
                  background: primaryBg, border: 'none',
                  color: variant === 'warning' ? '#000' : '#fff',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                  opacity: primary.disabled ? 0.5 : 1, transition: 'opacity .15s',
                  display: 'flex', alignItems: 'center', gap: 6 }}>
                {primary.loading && (
                  <span style={{ width: 10, height: 10, border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block',
                    animation: 'spin 0.7s linear infinite' }} />
                )}
                {primary.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

