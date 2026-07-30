'use client'

import React from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type DividerOrientation = 'horizontal' | 'vertical'
export type DividerVariant     = 'solid' | 'dashed' | 'dotted'
export type DividerSpacing     = 'none' | 'sm' | 'md' | 'lg'

export interface DividerProps {
  orientation?: DividerOrientation
  variant?:     DividerVariant
  spacing?:     DividerSpacing
  label?:       string
  color?:       string        // CSS color value, default var(--color-border)
  labelColor?:  string
  thickness?:   number        // px, default 1
  className?:   string
}

// ── Spacing maps ───────────────────────────────────────────────────────────

const H_SPACING: Record<DividerSpacing, string> = { none: 'my-0', sm: 'my-2', md: 'my-4', lg: 'my-6' }
const V_SPACING: Record<DividerSpacing, string> = { none: 'mx-0', sm: 'mx-2', md: 'mx-4', lg: 'mx-6' }

// ── Border style helper ────────────────────────────────────────────────────

function borderStyle(variant: DividerVariant, color: string, thickness: number, horizontal: boolean): React.CSSProperties {
  const side = horizontal ? 'borderTop' : 'borderLeft'
  return { [side]: `${thickness}px ${variant} ${color}` }
}

// ── Divider ────────────────────────────────────────────────────────────────

export function Divider({
  orientation = 'horizontal',
  variant     = 'solid',
  spacing     = 'md',
  label,
  color       = 'var(--color-border)',
  labelColor  = 'var(--color-dim)',
  thickness   = 1,
  className   = '',
}: DividerProps) {
  const isH = orientation === 'horizontal'

  // ── Vertical ──────────────────────────────────────────────────────────
  if (!isH) {
    return (
      <div
        className={`inline-block self-stretch flex-shrink-0 ${V_SPACING[spacing]} ${className}`}
        style={{ ...borderStyle(variant, color, thickness, false), height: 'auto' }}
        role="separator"
        aria-orientation="vertical"
      />
    )
  }

  // ── Horizontal without label ───────────────────────────────────────────
  if (!label) {
    return (
      <div
        className={`w-full ${H_SPACING[spacing]} ${className}`}
        style={borderStyle(variant, color, thickness, true)}
        role="separator"
        aria-orientation="horizontal"
      />
    )
  }

  // ── Horizontal with label ──────────────────────────────────────────────
  return (
    <div
      className={`flex items-center gap-3 w-full ${H_SPACING[spacing]} ${className}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
    >
      {/* Left line */}
      <div className="flex-1" style={borderStyle(variant, color, thickness, true)} />

      {/* Label */}
      <span
        className="text-[10px] font-semibold tracking-widest uppercase select-none flex-shrink-0"
        style={{ color: labelColor }}
      >
        {label}
      </span>

      {/* Right line */}
      <div className="flex-1" style={borderStyle(variant, color, thickness, true)} />
    </div>
  )
}

// ── SectionDivider — divider con titolo sezione a sinistra ─────────────────

export interface SectionDividerProps {
  title:    string
  action?:  React.ReactNode
  spacing?: DividerSpacing
}

export function SectionDivider({ title, action, spacing = 'md' }: SectionDividerProps) {
  return (
    <div className={`flex items-center gap-3 w-full ${H_SPACING[spacing]}`}>
      <span className="text-[9px] font-semibold tracking-[0.18em] uppercase flex-shrink-0"
        style={{ color: 'var(--color-dim)' }}>
        {title}
      </span>
      <div className="flex-1" style={{ borderTop: '1px solid var(--color-border)' }} />
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

// ── SpaceDivider — spaziatura senza linea visibile ─────────────────────────

export function SpaceDivider({ size = 'md' }: { size?: DividerSpacing }) {
  const PX: Record<DividerSpacing, number> = { none: 0, sm: 8, md: 16, lg: 32 }
  return <div style={{ height: PX[size] }} aria-hidden />
}

// ── OrDivider — shorthand per "oppure" nei form ────────────────────────────

export function OrDivider({ spacing = 'md' }: { spacing?: DividerSpacing }) {
  return <Divider label="oppure" spacing={spacing} />
}
