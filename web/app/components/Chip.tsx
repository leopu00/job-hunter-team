'use client'

import { type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type ChipVariant = 'filled' | 'outlined'
export type ChipColor   = 'default' | 'green' | 'red' | 'yellow' | 'blue' | 'orange' | 'purple'
export type ChipSize    = 'sm' | 'md' | 'lg'

export interface ChipProps {
  label:      string
  variant?:   ChipVariant
  color?:     ChipColor
  size?:      ChipSize
  icon?:      ReactNode
  selected?:  boolean
  disabled?:  boolean
  onClick?:   () => void
  onRemove?:  () => void
  className?: string
}

// ── Color tokens ───────────────────────────────────────────────────────────

const COLOR: Record<ChipColor, { base: string; bg: string; border: string }> = {
  default: { base: 'var(--color-muted)',  bg: 'var(--color-row)',             border: 'var(--color-border)' },
  green:   { base: 'var(--color-green)',  bg: 'rgba(0,232,122,0.12)',         border: 'rgba(0,232,122,0.4)' },
  red:     { base: 'var(--color-red)',    bg: 'rgba(255,69,96,0.12)',         border: 'rgba(255,69,96,0.4)'  },
  yellow:  { base: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.12)',        border: 'rgba(245,197,24,0.4)' },
  blue:    { base: 'var(--color-blue)',   bg: 'rgba(77,159,255,0.12)',        border: 'rgba(77,159,255,0.4)' },
  orange:  { base: 'var(--color-orange)', bg: 'rgba(255,140,66,0.12)',        border: 'rgba(255,140,66,0.4)' },
  purple:  { base: 'var(--color-purple)', bg: 'rgba(168,85,247,0.12)',        border: 'rgba(168,85,247,0.4)' },
}

const SIZE: Record<ChipSize, { h: number; px: number; font: number; icon: number; gap: number }> = {
  sm: { h: 20, px: 8,  font: 9,  icon: 10, gap: 3 },
  md: { h: 26, px: 10, font: 10, icon: 12, gap: 4 },
  lg: { h: 32, px: 12, font: 11, icon: 14, gap: 5 },
}

const ANIM = `@keyframes chip-pop { 0%{transform:scale(.85)}70%{transform:scale(1.05)}100%{transform:scale(1)} }`

// ── Chip ───────────────────────────────────────────────────────────────────

export function Chip({
  label, variant = 'filled', color = 'default', size = 'md',
  icon, selected = false, disabled = false,
  onClick, onRemove, className = '',
}: ChipProps) {
  const c   = COLOR[color]
  const s   = SIZE[size]
  const clickable = !!onClick && !disabled
  const sel = selected && clickable

  const bg     = variant === 'filled'   ? (sel ? c.base : c.bg)       : 'transparent'
  const border = variant === 'outlined' ? c.border                     : (sel ? c.base : c.border)
  const text   = sel                    ? (color === 'default' ? 'var(--color-bright)' : '#000') : c.base

  return (
    <>
      <style>{ANIM}</style>
      <span
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-pressed={clickable ? selected : undefined}
        aria-disabled={disabled}
        onClick={clickable ? onClick : undefined}
        onKeyDown={clickable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } } : undefined}
        className={`inline-flex items-center ${className}`}
        style={{
          height: s.h, paddingLeft: s.px, paddingRight: onRemove ? s.px / 2 : s.px,
          gap: s.gap, borderRadius: s.h / 2,
          background: bg, border: `1px solid ${border}`,
          color: text, fontFamily: 'var(--font-mono)', fontSize: s.font,
          fontWeight: sel ? 700 : 500, lineHeight: 1, whiteSpace: 'nowrap',
          cursor: clickable ? 'pointer' : 'default',
          opacity: disabled ? 0.45 : 1,
          transition: 'background .15s, border-color .15s, color .15s',
          userSelect: 'none',
          animation: selected ? 'chip-pop .2s ease' : undefined,
        }}
      >
        {/* Leading icon */}
        {icon && (
          <span style={{ display: 'flex', alignItems: 'center', fontSize: s.icon, flexShrink: 0 }}>
            {icon}
          </span>
        )}

        {label}

        {/* Remove button */}
        {onRemove && !disabled && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRemove() }}
            aria-label={`Rimuovi ${label}`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: s.icon + 2, height: s.icon + 2, borderRadius: '50%', flexShrink: 0,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: text, opacity: 0.7, transition: 'opacity .15s, background .15s',
              marginLeft: 1 }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.15)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
          >
            <svg width={s.icon - 2} height={s.icon - 2} viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </span>
    </>
  )
}

// ── ChipGroup ──────────────────────────────────────────────────────────────

export interface ChipGroupProps {
  chips:      (Omit<ChipProps, 'selected' | 'onClick'> & { key?: string })[]
  selected?:  string[]
  onSelect?:  (label: string) => void
  onRemove?:  (label: string) => void
  wrap?:      boolean
  gap?:       number
  className?: string
}

export function ChipGroup({
  chips, selected = [], onSelect, onRemove, wrap = true, gap = 6, className = '',
}: ChipGroupProps) {
  return (
    <div className={className}
      style={{ display: 'flex', flexWrap: wrap ? 'wrap' : 'nowrap', gap }}>
      {chips.map((chip, i) => (
        <Chip
          key={chip.key ?? chip.label ?? i}
          {...chip}
          selected={selected.includes(chip.label)}
          onClick={onSelect ? () => onSelect(chip.label) : undefined}
          onRemove={onRemove ? () => onRemove(chip.label) : chip.onRemove}
        />
      ))}
    </div>
  )
}
