'use client'

export type SwitchSize = 'sm' | 'md' | 'lg'
export type LabelPosition = 'left' | 'right'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  /** Descrizione secondaria sotto la label */
  description?: string
  labelPosition?: LabelPosition
  size?: SwitchSize
  disabled?: boolean
  /** id per associare label esterna */
  id?: string
}

const SIZE: Record<SwitchSize, { track: [number, number]; thumb: number; gap: number; fontSize: number }> = {
  sm: { track: [28, 16], thumb: 10, gap: 3,   fontSize: 10 },
  md: { track: [40, 22], thumb: 14, gap: 4,   fontSize: 11 },
  lg: { track: [52, 28], thumb: 18, gap: 5,   fontSize: 12 },
}

export default function Switch({
  checked,
  onChange,
  label,
  description,
  labelPosition = 'right',
  size = 'md',
  disabled = false,
  id,
}: SwitchProps) {
  const { track: [trackW, trackH], thumb, gap, fontSize } = SIZE[size]
  const thumbTravel = trackW - thumb - gap * 2

  const handleClick = () => { if (!disabled) onChange(!checked) }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleClick() }
  }

  /* ── Track ── */
  const track = (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKey}
      tabIndex={disabled ? -1 : 0}
      style={{
        position: 'relative', flexShrink: 0,
        width: trackW, height: trackH,
        borderRadius: trackH / 2,
        background: checked ? 'var(--color-green)' : 'var(--color-border)',
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.2s ease',
        outline: 'none',
        padding: 0,
      }}
      onFocus={e => { if (!disabled) e.currentTarget.style.boxShadow = `0 0 0 2px ${checked ? 'rgba(0,232,122,0.35)' : 'rgba(255,255,255,0.15)'}` }}
      onBlur={e => { e.currentTarget.style.boxShadow = 'none' }}
    >
      {/* Thumb */}
      <span style={{
        position: 'absolute',
        top: gap, left: gap,
        width: thumb, height: thumb,
        borderRadius: '50%',
        background: checked ? '#000' : 'var(--color-muted)',
        transform: checked ? `translateX(${thumbTravel}px)` : 'translateX(0)',
        transition: 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1), background 0.2s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        display: 'block',
      }} />
    </button>
  )

  /* ── Senza label ── */
  if (!label && !description) return track

  /* ── Con label ── */
  const labelEl = (
    <div
      onClick={handleClick}
      style={{ cursor: disabled ? 'default' : 'pointer', userSelect: 'none' }}>
      {label && (
        <div style={{ fontSize, fontWeight: 500, color: disabled ? 'var(--color-dim)' : 'var(--color-muted)', lineHeight: 1.2 }}>
          {label}
        </div>
      )}
      {description && (
        <div style={{ fontSize: fontSize - 1, color: 'var(--color-dim)', marginTop: 1, lineHeight: 1.3 }}>
          {description}
        </div>
      )}
    </div>
  )

  return (
    <div style={{
      display: 'flex',
      alignItems: description ? 'flex-start' : 'center',
      gap: size === 'sm' ? 6 : size === 'lg' ? 10 : 8,
      flexDirection: labelPosition === 'left' ? 'row-reverse' : 'row',
    }}>
      {track}
      {labelEl}
    </div>
  )
}
