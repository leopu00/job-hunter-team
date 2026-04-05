'use client'

import { type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type BadgeVariant = 'count' | 'dot'

export interface NotificationBadgeProps {
  children:    ReactNode          // icona/elemento su cui applicare il badge
  count?:      number             // numero notifiche (0 = nasconde badge)
  max?:        number             // soglia 99+, default 99
  variant?:    BadgeVariant       // 'count' (numero) | 'dot' (pallino)
  pulse?:      boolean            // animazione pulse per nuove notifiche
  color?:      string             // colore badge, default --color-red
  offset?:     [number, number]   // [x, y] offset px dal corner, default [0,0]
  showZero?:   boolean            // mostra badge anche con count=0
  className?:  string
}

// ── Styles ─────────────────────────────────────────────────────────────────

const ANIM = `
@keyframes nb-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--nb-color); opacity: 1; }
  50%       { box-shadow: 0 0 0 5px transparent; opacity: 0.85; }
}
@keyframes nb-pop {
  0%   { transform: translate(50%, -50%) scale(0); }
  70%  { transform: translate(50%, -50%) scale(1.2); }
  100% { transform: translate(50%, -50%) scale(1); }
}
`

// ── NotificationBadge ──────────────────────────────────────────────────────

export function NotificationBadge({
  children, count = 0, max = 99, variant = 'count',
  pulse = false, color = 'var(--color-red)',
  offset = [0, 0], showZero = false, className = '',
}: NotificationBadgeProps) {
  const visible = showZero ? count >= 0 : count > 0
  const label   = count > max ? `${max}+` : String(count)

  return (
    <div className={`relative inline-flex ${className}`} style={{ display: 'inline-flex' }}>
      <style>{ANIM}</style>
      {children}

      {visible && (
        <span
          aria-label={`${count} notifiche`}
          style={{
            '--nb-color': color,
            position: 'absolute',
            top:   0,
            right: 0,
            transform: `translate(calc(50% + ${offset[0]}px), calc(-50% + ${-offset[1]}px))`,
            zIndex: 1,

            /* Dot mode */
            ...(variant === 'dot' ? {
              width: 8, height: 8, borderRadius: '50%',
              background: color,
              border: '1.5px solid var(--color-card)',
              animation: pulse ? 'nb-pulse 1.4s ease infinite' : 'nb-pop .25s ease',
            } : {
              /* Count mode */
              minWidth: label.length > 2 ? 22 : 18,
              height: 18,
              borderRadius: 9,
              padding: '0 4px',
              background: color,
              border: '1.5px solid var(--color-card)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
              color: '#fff', lineHeight: 1, whiteSpace: 'nowrap',
              animation: pulse ? 'nb-pulse 1.4s ease infinite' : 'nb-pop .25s ease',
            }),
          } as unknown as React.CSSProperties}
        >
          {variant === 'count' ? label : null}
        </span>
      )}
    </div>
  )
}

// ── IconBell — esempio pronto all'uso ──────────────────────────────────────

export interface IconBellProps {
  count?:   number
  pulse?:   boolean
  onClick?: () => void
  size?:    number
}

export function IconBell({ count = 0, pulse = false, onClick, size = 20 }: IconBellProps) {
  return (
    <NotificationBadge count={count} pulse={pulse}>
      <button type="button" onClick={onClick}
        style={{ background: 'none', border: 'none', cursor: onClick ? 'pointer' : 'default',
          color: 'var(--color-muted)', padding: 4, lineHeight: 1, display: 'flex' }}
        aria-label={`Notifiche${count ? `: ${count}` : ''}`}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </button>
    </NotificationBadge>
  )
}
