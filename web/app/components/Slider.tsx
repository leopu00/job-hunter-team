'use client'

import { useRef, useCallback, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface SliderMark { value: number; label?: string }

interface SliderBaseProps {
  min?:       number
  max?:       number
  step?:      number
  marks?:     SliderMark[]
  disabled?:  boolean
  showValue?: boolean
  label?:     string
  className?: string
}

export interface SingleSliderProps extends SliderBaseProps {
  value:    number
  onChange: (v: number) => void
  range?:   false
}

export interface RangeSliderProps extends SliderBaseProps {
  value:    [number, number]
  onChange: (v: [number, number]) => void
  range:    true
}

export type SliderProps = SingleSliderProps | RangeSliderProps

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

function snap(v: number, step: number, min: number) {
  return Math.round((v - min) / step) * step + min
}

function pct(v: number, min: number, max: number) {
  return ((v - min) / (max - min)) * 100
}

// ── Thumb ──────────────────────────────────────────────────────────────────

interface ThumbProps {
  value: number; min: number; max: number; step: number
  onDrag: (v: number) => void; disabled: boolean; label: string
}

function Thumb({ value, min, max, step, onDrag, disabled, label }: ThumbProps) {
  const [tip, setTip] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const startDrag = useCallback((clientX: number) => {
    const track = (trackRef.current?.parentElement) as HTMLDivElement
    if (!track) return
    const move = (cx: number) => {
      const rect = track.getBoundingClientRect()
      const raw  = ((cx - rect.left) / rect.width) * (max - min) + min
      onDrag(clamp(snap(raw, step, min), min, max))
    }
    const onMove  = (e: MouseEvent)  => move(e.clientX)
    const onTouch = (e: TouchEvent)  => move(e.touches[0].clientX)
    const stop    = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', stop); document.removeEventListener('touchmove', onTouch); document.removeEventListener('touchend', stop) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', stop)
    document.addEventListener('touchmove', onTouch)
    document.addEventListener('touchend', stop)
  }, [min, max, step, onDrag])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { e.preventDefault(); onDrag(clamp(snap(value + step, step, min), min, max)) }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') { e.preventDefault(); onDrag(clamp(snap(value - step, step, min), min, max)) }
  }

  return (
    <div ref={trackRef} style={{ position: 'absolute', left: `${pct(value, min, max)}%`, transform: 'translate(-50%, -50%)', top: '50%', zIndex: 2 }}
      onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
      {/* Tooltip */}
      {tip && (
        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6,
          background: 'var(--color-deep)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 9, color: 'var(--color-bright)', fontFamily: 'var(--font-mono)' }}>{value}</span>
        </div>
      )}
      {/* Thumb circle */}
      <div role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
        tabIndex={disabled ? -1 : 0}
        onMouseDown={disabled ? undefined : e => { e.preventDefault(); startDrag(e.clientX) }}
        onTouchStart={disabled ? undefined : e => { e.preventDefault(); startDrag(e.touches[0].clientX) }}
        onKeyDown={disabled ? undefined : onKey}
        style={{ width: 16, height: 16, borderRadius: '50%', cursor: disabled ? 'not-allowed' : 'grab',
          background: disabled ? 'var(--color-border)' : 'var(--color-green)',
          border: '2px solid var(--color-deep)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}
        className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] focus-visible:ring-offset-1" />
    </div>
  )
}

// ── Slider ─────────────────────────────────────────────────────────────────

export function Slider(props: SliderProps) {
  const { min = 0, max = 100, step = 1, marks, disabled = false, showValue = false, label, className = '' } = props
  const isRange = props.range === true
  const lo = isRange ? (props.value as [number,number])[0] : (props.value as number)
  const hi = isRange ? (props.value as [number,number])[1] : (props.value as number)
  const loPct = pct(lo, min, max), hiPct = pct(hi, min, max)

  const setLo = (v: number) => isRange ? (props as RangeSliderProps).onChange([Math.min(v, hi), hi]) : (props as SingleSliderProps).onChange(v)
  const setHi = (v: number) => isRange ? (props as RangeSliderProps).onChange([lo, Math.max(v, lo)]) : undefined

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && <span style={{ fontSize: 10, color: 'var(--color-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>}
          {showValue && <span style={{ fontSize: 10, color: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }}>{isRange ? `${lo} – ${hi}` : lo}</span>}
        </div>
      )}

      {/* Track */}
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', inset: '0 0', height: 4, top: '50%', transform: 'translateY(-50%)',
          background: 'var(--color-row)', borderRadius: 99, border: '1px solid var(--color-border)' }} />
        {/* Active fill */}
        <div style={{ position: 'absolute', height: 4, top: '50%', transform: 'translateY(-50%)', borderRadius: 99,
          left: `${isRange ? loPct : 0}%`, width: `${(isRange ? hiPct : loPct) - (isRange ? loPct : 0)}%`,
          background: disabled ? 'var(--color-border)' : 'var(--color-green)' }} />
        {/* Thumbs */}
        <Thumb value={lo} min={min} max={max} step={step} onDrag={setLo} disabled={disabled} label={isRange ? 'Minimo' : (label ?? 'Valore')} />
        {isRange && <Thumb value={hi} min={min} max={max} step={step} onDrag={setHi!} disabled={disabled} label="Massimo" />}
      </div>

      {/* Marks */}
      {marks && (
        <div style={{ position: 'relative', height: 16 }}>
          {marks.map(m => (
            <div key={m.value} style={{ position: 'absolute', left: `${pct(m.value, min, max)}%`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ width: 2, height: 4, background: 'var(--color-border)', borderRadius: 1 }} />
              {m.label && <span style={{ fontSize: 8, color: 'var(--color-dim)', whiteSpace: 'nowrap' }}>{m.label}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
