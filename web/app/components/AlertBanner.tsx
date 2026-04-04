'use client'

import { useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type AlertType = 'info' | 'warning' | 'error' | 'success'

export interface AlertBannerProps {
  message:      string
  type?:        AlertType
  dismissible?: boolean
  action?:      { label: string; onClick: () => void }
  icon?:        boolean       // mostra icona tipo (default true)
  position?:    'fixed' | 'inline'
  onDismiss?:   () => void
}

// ── Style maps ─────────────────────────────────────────────────────────────

const TYPE_STYLE: Record<AlertType, React.CSSProperties> = {
  info:    { background: 'color-mix(in srgb, var(--color-blue) 12%, var(--color-panel))',   color: 'var(--color-blue)',   borderBottom: '1px solid color-mix(in srgb, var(--color-blue) 25%, transparent)' },
  warning: { background: 'color-mix(in srgb, var(--color-yellow) 12%, var(--color-panel))', color: 'var(--color-yellow)', borderBottom: '1px solid color-mix(in srgb, var(--color-yellow) 25%, transparent)' },
  error:   { background: 'color-mix(in srgb, var(--color-red) 12%, var(--color-panel))',    color: 'var(--color-red)',    borderBottom: '1px solid color-mix(in srgb, var(--color-red) 25%, transparent)' },
  success: { background: 'color-mix(in srgb, var(--color-green) 12%, var(--color-panel))',  color: 'var(--color-green)',  borderBottom: '1px solid color-mix(in srgb, var(--color-green) 25%, transparent)' },
}

const ACTION_STYLE: Record<AlertType, React.CSSProperties> = {
  info:    { border: '1px solid color-mix(in srgb, var(--color-blue) 40%, transparent)',   color: 'var(--color-blue)' },
  warning: { border: '1px solid color-mix(in srgb, var(--color-yellow) 40%, transparent)', color: 'var(--color-yellow)' },
  error:   { border: '1px solid color-mix(in srgb, var(--color-red) 40%, transparent)',    color: 'var(--color-red)' },
  success: { border: '1px solid color-mix(in srgb, var(--color-green) 40%, transparent)',  color: 'var(--color-green)' },
}

// ── Icons ──────────────────────────────────────────────────────────────────

function Icon({ type }: { type: AlertType }) {
  const props = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 as number }
  if (type === 'success') return (
    <svg {...props}><polyline points="20 6 9 17 4 12" /></svg>
  )
  if (type === 'error') return (
    <svg {...props}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
  )
  if (type === 'warning') return (
    <svg {...props}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
  )
  return (
    <svg {...props}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
  )
}

// ── AlertBanner ────────────────────────────────────────────────────────────

export function AlertBanner({
  message, type = 'info', dismissible = true,
  action, icon = true, position = 'fixed', onDismiss,
}: AlertBannerProps) {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  const dismiss = () => { setVisible(false); onDismiss?.() }

  const posStyle: React.CSSProperties = position === 'fixed'
    ? { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100 }
    : { position: 'relative' }

  return (
    <>
      <style>{`
        @keyframes banner-slide-down {
          from { opacity: 0; transform: translateY(-100%); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        role="alert"
        style={{
          ...posStyle,
          ...TYPE_STYLE[type],
          animation: 'banner-slide-down 0.25s ease both',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-2.5 max-w-screen-xl mx-auto">
          {/* Icon */}
          {icon && (
            <span className="flex-shrink-0 flex items-center" style={{ color: 'currentColor' }}>
              <Icon type={type} />
            </span>
          )}

          {/* Message */}
          <p className="flex-1 text-[11px] font-medium leading-snug min-w-0" style={{ color: 'currentColor' }}>
            {message}
          </p>

          {/* CTA action */}
          {action && (
            <button
              onClick={action.onClick}
              className="flex-shrink-0 px-3 py-1 rounded text-[10px] font-bold cursor-pointer bg-transparent transition-opacity hover:opacity-80"
              style={ACTION_STYLE[type]}
            >
              {action.label}
            </button>
          )}

          {/* Dismiss */}
          {dismissible && (
            <button
              onClick={dismiss}
              className="flex-shrink-0 flex items-center justify-center cursor-pointer bg-transparent border-0 p-0 transition-opacity hover:opacity-60"
              style={{ color: 'currentColor' }}
              aria-label="Chiudi"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Spacer per fixed (evita overlap col contenuto) */}
      {position === 'fixed' && <div style={{ height: 40 }} aria-hidden />}
    </>
  )
}

// ── AlertBannerStack ───────────────────────────────────────────────────────

export interface BannerItem extends AlertBannerProps { id: string }

export interface AlertBannerStackProps {
  banners:   BannerItem[]
  onDismiss: (id: string) => void
}

export function AlertBannerStack({ banners, onDismiss }: AlertBannerStackProps) {
  if (!banners.length) return null
  return (
    <>
      {banners.map((b, i) => (
        <AlertBanner
          key={b.id}
          {...b}
          position="inline"
          style={{ marginTop: i > 0 ? 1 : 0 } as React.CSSProperties}
          onDismiss={() => onDismiss(b.id)}
        />
      ))}
    </>
  )
}
