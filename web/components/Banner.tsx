'use client'

import { useState } from 'react'

export type BannerVariant = 'info' | 'warning' | 'error' | 'success'

export interface BannerAction {
  label: string
  onClick?: () => void
  href?: string
}

export interface BannerProps {
  variant?: BannerVariant
  /** Icona custom — se omessa usa quella di default della variante */
  icon?: string
  message: string
  /** Testo secondario opzionale */
  description?: string
  action?: BannerAction
  dismissible?: boolean
  onDismiss?: () => void
  /** Se false, il componente è controllato dall'esterno (non gestisce dismissed internamente) */
  defaultVisible?: boolean
}

const VARIANT_CONFIG: Record<BannerVariant, { icon: string; bg: string; border: string; color: string; accent: string }> = {
  info:    { icon: 'ℹ️',  bg: 'rgba(96,165,250,0.08)',  border: '#3b82f6', color: '#93c5fd', accent: '#60a5fa' },
  warning: { icon: '⚠️',  bg: 'rgba(251,191,36,0.08)',  border: '#d97706', color: '#fcd34d', accent: '#fbbf24' },
  error:   { icon: '✕',   bg: 'rgba(239,68,68,0.08)',   border: 'var(--color-red)', color: '#fca5a5', accent: '#ef4444' },
  success: { icon: '✓',   bg: 'rgba(0,232,122,0.08)',   border: 'var(--color-green)', color: 'var(--color-green)', accent: 'var(--color-green)' },
}

export default function Banner({
  variant = 'info',
  icon,
  message,
  description,
  action,
  dismissible = true,
  onDismiss,
  defaultVisible = true,
}: BannerProps) {
  const [visible, setVisible] = useState(defaultVisible)
  const [hiding, setHiding]   = useState(false)

  const cfg = VARIANT_CONFIG[variant]

  const dismiss = () => {
    setHiding(true)
    setTimeout(() => {
      setVisible(false)
      onDismiss?.()
    }, 220)
  }

  if (!visible) return null

  return (
    <div
      role="alert"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 14px',
        background: cfg.bg,
        borderLeft: `3px solid ${cfg.border}`,
        borderRadius: 8,
        opacity: hiding ? 0 : 1,
        transform: hiding ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        position: 'relative',
      }}>
      {/* Icona */}
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1, color: cfg.accent }}>
        {icon ?? cfg.icon}
      </span>

      {/* Testo */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>
          {message}
        </span>
        {description && (
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-muted)', lineHeight: 1.4 }}>
            {description}
          </p>
        )}
      </div>

      {/* Azione */}
      {action && (
        action.href ? (
          <a
            href={action.href}
            target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: 11, fontWeight: 600, flexShrink: 0, textDecoration: 'underline',
              color: cfg.accent, cursor: 'pointer', alignSelf: 'center',
            }}>
            {action.label} ↗
          </a>
        ) : (
          <button
            onClick={action.onClick}
            style={{
              fontSize: 11, fontWeight: 600, flexShrink: 0,
              padding: '3px 10px', borderRadius: 5,
              border: `1px solid ${cfg.border}`,
              background: 'transparent', color: cfg.accent,
              cursor: 'pointer', alignSelf: 'center',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = cfg.bg}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            {action.label}
          </button>
        )
      )}

      {/* Dismiss */}
      {dismissible && (
        <button
          onClick={dismiss}
          aria-label="Chiudi"
          style={{
            flexShrink: 0, background: 'none', border: 'none',
            color: 'var(--color-dim)', cursor: 'pointer',
            fontSize: 14, lineHeight: 1, padding: '0 2px',
            alignSelf: 'flex-start', marginTop: 1,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = cfg.color}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>
          ×
        </button>
      )}
    </div>
  )
}
