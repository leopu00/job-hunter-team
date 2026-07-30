'use client'

import React from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type CardVariant = 'default' | 'outlined' | 'elevated'
export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

export interface CardProps {
  children?:  React.ReactNode
  title?:     string
  subtitle?:  string
  action?:    React.ReactNode      // slot header top-right
  footer?:    React.ReactNode      // slot footer
  variant?:   CardVariant
  padding?:   CardPadding
  hoverable?: boolean
  onClick?:   () => void
  className?: string
  style?:     React.CSSProperties
}

// ── Style maps ─────────────────────────────────────────────────────────────

const VARIANT_STYLE: Record<CardVariant, React.CSSProperties> = {
  default:  { background: 'var(--color-panel)', border: '1px solid var(--color-border)', boxShadow: 'none' },
  outlined: { background: 'transparent',        border: '1px solid var(--color-border)', boxShadow: 'none' },
  elevated: { background: 'var(--color-panel)', border: '1px solid var(--color-border)', boxShadow: '0 4px 24px color-mix(in srgb, var(--color-void) 40%, transparent)' },
}

const PADDING_CLS: Record<CardPadding, string> = {
  none: '',
  sm:   'p-3',
  md:   'p-5',
  lg:   'p-7',
}

const HEADER_PAD: Record<CardPadding, string> = {
  none: 'px-4 py-3',
  sm:   'px-3 py-2',
  md:   'px-5 py-4',
  lg:   'px-7 py-5',
}

const FOOTER_PAD: Record<CardPadding, string> = {
  none: 'px-4 py-3',
  sm:   'px-3 py-2',
  md:   'px-5 py-4',
  lg:   'px-7 py-5',
}

// ── Card ───────────────────────────────────────────────────────────────────

export function Card({
  children, title, subtitle, action, footer,
  variant = 'default', padding = 'md',
  hoverable = false, onClick, className = '', style,
}: CardProps) {
  const hasHeader = !!(title || subtitle || action)
  const isClickable = !!onClick
  const interactive = hoverable || isClickable

  const baseStyle: React.CSSProperties = {
    ...VARIANT_STYLE[variant],
    borderRadius: 12,
    overflow: 'hidden',
    transition: interactive ? 'border-color 0.15s, box-shadow 0.15s, transform 0.15s' : undefined,
    cursor: isClickable ? 'pointer' : undefined,
    ...style,
  }

  return (
    <div
      className={`${interactive ? 'card-interactive' : ''} ${className}`}
      style={baseStyle}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? e => (e.key === 'Enter' || e.key === ' ') && onClick?.() : undefined}
    >
      {/* Header */}
      {hasHeader && (
        <div
          className={`flex items-start justify-between gap-3 ${HEADER_PAD[padding]}`}
          style={{ borderBottom: children || footer ? '1px solid var(--color-border)' : undefined }}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            {title && (
              <p className="text-[12px] font-bold tracking-wide truncate" style={{ color: 'var(--color-bright)' }}>
                {title}
              </p>
            )}
            {subtitle && (
              <p className="text-[10px] leading-snug" style={{ color: 'var(--color-dim)' }}>
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}

      {/* Body */}
      {children && (
        <div className={hasHeader || !padding ? PADDING_CLS[padding] : PADDING_CLS[padding]}>
          {children}
        </div>
      )}

      {/* Footer */}
      {footer && (
        <div
          className={`${FOOTER_PAD[padding]}`}
          style={{ borderTop: '1px solid var(--color-border)', background: 'color-mix(in srgb, var(--color-void) 20%, transparent)' }}
        >
          {footer}
        </div>
      )}

      <style>{`
        .card-interactive:hover {
          border-color: var(--color-muted) !important;
          box-shadow: 0 2px 12px color-mix(in srgb, var(--color-void) 30%, transparent);
        }
        .card-interactive:active { transform: scale(0.995); }
      `}</style>
    </div>
  )
}

// ── CardGrid ───────────────────────────────────────────────────────────────

export interface CardGridProps {
  children:   React.ReactNode
  cols?:      1 | 2 | 3 | 4
  gap?:       'sm' | 'md' | 'lg'
}

const COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', 4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' }
const GAPS: Record<string, string> = { sm: 'gap-3', md: 'gap-5', lg: 'gap-7' }

export function CardGrid({ children, cols = 3, gap = 'md' }: CardGridProps) {
  return (
    <div className={`grid ${COLS[cols]} ${GAPS[gap]}`}>
      {children}
    </div>
  )
}

// ── StatCard (shorthand) ───────────────────────────────────────────────────

export interface StatCardProps {
  label:    string
  value:    string | number
  sub?:     string
  trend?:   number   // positivo = verde, negativo = rosso
  variant?: CardVariant
}

export function StatCard({ label, value, sub, trend, variant = 'default' }: StatCardProps) {
  const trendColor = trend === undefined ? undefined : trend >= 0 ? 'var(--color-green)' : 'var(--color-red)'
  return (
    <Card variant={variant} padding="md">
      <p className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>{label}</p>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold leading-none" style={{ color: 'var(--color-bright)' }}>{value}</span>
        {trend !== undefined && (
          <span className="text-[10px] font-semibold mb-0.5" style={{ color: trendColor }}>
            {trend >= 0 ? '↑' : '↓'}{Math.abs(trend)}%
          </span>
        )}
      </div>
      {sub && <p className="text-[10px] mt-1" style={{ color: 'var(--color-dim)' }}>{sub}</p>}
    </Card>
  )
}
