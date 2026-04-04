'use client'

import { useState } from 'react'

export type RatingSize = 'sm' | 'md' | 'lg'

export interface RatingProps {
  value: number
  onChange?: (value: number) => void
  max?: number
  /** Abilita mezze stelle */
  half?: boolean
  readonly?: boolean
  size?: RatingSize
  /** Icona custom — default '★' */
  icon?: string
  /** Mostra valore numerico a fianco */
  showValue?: boolean
  /** Label accessibilità */
  label?: string
}

const SIZE_MAP: Record<RatingSize, { fontSize: number; gap: number; labelSize: number }> = {
  sm: { fontSize: 16, gap: 2,  labelSize: 10 },
  md: { fontSize: 24, gap: 3,  labelSize: 12 },
  lg: { fontSize: 32, gap: 4,  labelSize: 14 },
}

/* ── Stella SVG con fill parziale ── */
function Star({ fill, fontSize, icon, color }: { fill: number; fontSize: number; icon: string; color: string }) {
  const id = `clip-${Math.random().toString(36).slice(2)}`
  if (icon !== '★') {
    // Emoji — usa opacity per simulare fill parziale
    return (
      <span style={{ fontSize, position: 'relative', display: 'inline-block', lineHeight: 1 }}>
        <span style={{ opacity: 0.2 }}>{icon}</span>
        <span style={{ position: 'absolute', left: 0, top: 0, width: `${fill * 100}%`, overflow: 'hidden' }}>{icon}</span>
      </span>
    )
  }
  return (
    <svg width={fontSize} height={fontSize} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <clipPath id={id}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      {/* Stella vuota */}
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      {/* Stella piena (clipped) */}
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill={color} clipPath={`url(#${id})`} />
    </svg>
  )
}

export default function Rating({
  value,
  onChange,
  max = 5,
  half = false,
  readonly = false,
  size = 'md',
  icon = '★',
  showValue = false,
  label,
}: RatingProps) {
  const [hover, setHover] = useState<number | null>(null)
  const { fontSize, gap, labelSize } = SIZE_MAP[size]

  const displayed = hover ?? value
  const color = 'var(--color-green, #00e87a)'
  const isInteractive = !readonly && !!onChange

  const getStarValue = (starIdx: number, e?: React.MouseEvent): number => {
    if (half && e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      return (e.clientX - rect.left) < rect.width / 2 ? starIdx - 0.5 : starIdx
    }
    return starIdx
  }

  const handleClick = (starIdx: number, e: React.MouseEvent) => {
    if (!isInteractive) return
    const v = getStarValue(starIdx, e)
    onChange!(value === v ? 0 : v)
  }

  const handleMouseMove = (starIdx: number, e: React.MouseEvent) => {
    if (!isInteractive) return
    setHover(getStarValue(starIdx, e))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isInteractive) return
    if (e.key === 'ArrowRight') { e.preventDefault(); onChange!(Math.min(value + (half ? 0.5 : 1), max)) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); onChange!(Math.max(value - (half ? 0.5 : 1), 0)) }
    if (e.key === 'Home') { e.preventDefault(); onChange!(0) }
    if (e.key === 'End')  { e.preventDefault(); onChange!(max) }
  }

  const getFill = (i: number): number => {
    const v = displayed
    if (v >= i) return 1
    if (v >= i - 0.5) return 0.5
    return 0
  }

  return (
    <div
      role={isInteractive ? 'slider' : 'img'}
      aria-label={label ?? `Valutazione: ${value} su ${max}`}
      aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}
      tabIndex={isInteractive ? 0 : -1}
      onKeyDown={handleKeyDown}
      onMouseLeave={() => isInteractive && setHover(null)}
      style={{ display: 'inline-flex', alignItems: 'center', gap, outline: 'none', cursor: isInteractive ? 'pointer' : 'default' }}>
      {Array.from({ length: max }, (_, i) => (
        <div
          key={i}
          onClick={e => handleClick(i + 1, e)}
          onMouseMove={e => handleMouseMove(i + 1, e)}
          style={{ cursor: isInteractive ? 'pointer' : 'default', flexShrink: 0 }}>
          <Star fill={getFill(i + 1)} fontSize={fontSize} icon={icon} color={color} />
        </div>
      ))}
      {showValue && (
        <span style={{ fontSize: labelSize, color: 'var(--color-dim)', marginLeft: gap, fontVariantNumeric: 'tabular-nums' }}>
          {value > 0 ? value.toFixed(half ? 1 : 0) : '—'} / {max}
        </span>
      )}
    </div>
  )
}
