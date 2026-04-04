'use client'

import { useEffect, useRef, useState } from 'react'

export type SegmentedSize = 'sm' | 'md' | 'lg'

export interface Segment {
  value: string
  label: string
  icon?: string
  disabled?: boolean
}

export interface SegmentedControlProps {
  segments: Segment[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  size?: SegmentedSize
  /** Larghezza fissa in px — di default si adatta al contenuto */
  width?: number
  disabled?: boolean
}

const SIZE_MAP: Record<SegmentedSize, { h: number; px: number; fontSize: number; radius: number }> = {
  sm: { h: 28, px: 10, fontSize: 10, radius: 6  },
  md: { h: 34, px: 14, fontSize: 11, radius: 8  },
  lg: { h: 42, px: 18, fontSize: 13, radius: 10 },
}

export default function SegmentedControl({
  segments,
  value: controlledValue,
  defaultValue,
  onChange,
  size = 'md',
  width,
  disabled = false,
}: SegmentedControlProps) {
  const isControlled = controlledValue !== undefined
  const [internal, setInternal] = useState(defaultValue ?? segments[0]?.value ?? '')
  const active = isControlled ? controlledValue! : internal

  const containerRef = useRef<HTMLDivElement>(null)
  const [thumbStyle, setThumbStyle] = useState<React.CSSProperties>({})
  const { h, px, fontSize, radius } = SIZE_MAP[size]
  const pad = 3 // padding interno track

  /* ── Calcola posizione thumb ── */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const idx  = segments.findIndex(s => s.value === active)
    if (idx < 0) return
    const btns = container.querySelectorAll<HTMLButtonElement>('[data-seg]')
    const btn  = btns[idx]
    if (!btn) return
    const cRect = container.getBoundingClientRect()
    const bRect = btn.getBoundingClientRect()
    setThumbStyle({
      left:  bRect.left  - cRect.left,
      width: bRect.width,
      top:   pad,
      height: h - pad * 2,
    })
  }, [active, segments, size])

  const select = (seg: Segment) => {
    if (disabled || seg.disabled) return
    if (!isControlled) setInternal(seg.value)
    onChange?.(seg.value)
  }

  /* ── Keyboard nav ── */
  const handleKey = (e: React.KeyboardEvent, idx: number) => {
    const navigable = segments.filter(s => !s.disabled)
    const navIdx    = navigable.findIndex(s => s.value === segments[idx].value)
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = navigable[(navIdx + 1) % navigable.length]
      if (next) select(next)
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = navigable[(navIdx - 1 + navigable.length) % navigable.length]
      if (prev) select(prev)
    }
  }

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    background: 'var(--color-row)',
    border: '1px solid var(--color-border)',
    borderRadius: radius + pad,
    padding: pad,
    height: h,
    width: width ?? 'auto',
    opacity: disabled ? 0.5 : 1,
    userSelect: 'none',
  }

  return (
    <div ref={containerRef} role="group" style={containerStyle}>
      {/* Thumb diapositive */}
      {thumbStyle.width && (
        <div style={{
          position: 'absolute',
          borderRadius: radius,
          background: 'var(--color-panel)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
          transition: 'left 0.2s cubic-bezier(0.34,1.1,0.64,1), width 0.15s ease',
          pointerEvents: 'none',
          zIndex: 0,
          ...thumbStyle,
        }} />
      )}

      {segments.map((seg, i) => {
        const isActive   = seg.value === active
        const isDisabled = disabled || seg.disabled
        return (
          <button
            key={seg.value}
            data-seg
            role="radio"
            aria-checked={isActive}
            disabled={isDisabled}
            tabIndex={isActive ? 0 : -1}
            onClick={() => select(seg)}
            onKeyDown={e => handleKey(e, i)}
            style={{
              position: 'relative', zIndex: 1,
              flex: width ? 1 : undefined,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              padding: `0 ${px}px`,
              height: h - pad * 2,
              minWidth: 40,
              border: 'none', borderRadius: radius,
              background: 'transparent',
              fontSize,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--color-bright)' : isDisabled ? 'var(--color-border)' : 'var(--color-dim)',
              cursor: isDisabled ? 'default' : 'pointer',
              transition: 'color 0.15s ease',
              whiteSpace: 'nowrap',
            }}>
            {seg.icon && <span style={{ fontSize: fontSize + 1 }}>{seg.icon}</span>}
            {seg.label}
          </button>
        )
      })}
    </div>
  )
}
