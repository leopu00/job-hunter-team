'use client'

import { useEffect, useRef, useState } from 'react'

export interface InputSliderProps {
  value?: number
  defaultValue?: number
  onChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  unit?: string
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Mostra tick marks sotto il slider */
  ticks?: boolean
}

const SIZE_MAP = {
  sm: { trackH: 3,  thumb: 14, font: 11, inputW: 60  },
  md: { trackH: 4,  thumb: 18, font: 13, inputW: 72  },
  lg: { trackH: 5,  thumb: 22, font: 14, inputW: 84  },
}

/* Inietta stili globali per il thumb una volta sola */
let stylesInjected = false
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const s = document.createElement('style')
  s.textContent = `
    .jht-islider::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; border-radius:50%; background:var(--color-green,#00e87a); cursor:pointer; border:2px solid var(--color-panel); transition:transform .15s; }
    .jht-islider::-webkit-slider-thumb:hover { transform:scale(1.2); }
    .jht-islider::-moz-range-thumb { border-radius:50%; background:var(--color-green,#00e87a); cursor:pointer; border:2px solid var(--color-panel); }
    .jht-islider:focus { outline:none; }
    .jht-islider:focus::-webkit-slider-thumb { box-shadow:0 0 0 3px color-mix(in srgb,var(--color-green,#00e87a) 30%,transparent); }
  `
  document.head.appendChild(s)
}

export default function InputSlider({
  value: ctrl, defaultValue = 0, onChange,
  min = 0, max = 100, step = 1,
  label, unit, disabled = false, size = 'md', ticks = false,
}: InputSliderProps) {
  const isCtrl = ctrl !== undefined
  const [internal, setInternal] = useState(defaultValue)
  const value = isCtrl ? ctrl! : internal
  const [inputVal, setInputVal] = useState(String(value))
  const { trackH, thumb, font, inputW } = SIZE_MAP[size]

  useEffect(() => { injectStyles() }, [])
  useEffect(() => { setInputVal(String(value)) }, [value])

  const clamp = (v: number) => Math.min(max, Math.max(min, isNaN(v) ? min : Math.round(v / step) * step))

  const commit = (v: number) => {
    const clamped = clamp(v)
    if (!isCtrl) setInternal(clamped)
    onChange?.(clamped)
    setInputVal(String(clamped))
    return clamped
  }

  const pct = ((value - min) / (max - min)) * 100

  /* Slider background gradient */
  const trackBg = `linear-gradient(to right, var(--color-green,#00e87a) ${pct}%, var(--color-border) ${pct}%)`

  /* Tick marks */
  const tickCount = Math.floor((max - min) / step)
  const showTicks  = ticks && tickCount <= 20

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: disabled ? 0.5 : 1 }}>
      {/* Label + valore */}
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: font, fontWeight: 500, color: 'var(--color-bright)' }}>{label}</span>
          <span style={{ fontSize: font - 1, color: 'var(--color-green,#00e87a)', fontWeight: 600 }}>
            {value}{unit ? ` ${unit}` : ''}
          </span>
        </div>
      )}

      {/* Slider + input affiancati */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Slider */}
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type="range"
            className="jht-islider"
            min={min} max={max} step={step}
            value={value}
            disabled={disabled}
            onChange={e => commit(Number(e.target.value))}
            style={{
              width: '100%',
              height: thumb,
              appearance: 'none', WebkitAppearance: 'none',
              background: trackBg,
              borderRadius: trackH,
              cursor: disabled ? 'default' : 'pointer',
              outline: 'none',
              // thumb size via CSS var trick for webkit
              ['--thumb-size' as string]: `${thumb}px`,
            }}
          />
          {/* Ticks */}
          {showTicks && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: `0 ${thumb / 2}px`, marginTop: 2 }}>
              {Array.from({ length: tickCount + 1 }, (_, i) => (
                <div key={i} style={{ width: 1, height: 4, background: 'var(--color-border)', flexShrink: 0 }} />
              ))}
            </div>
          )}
        </div>

        {/* Input numerico */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            type="number"
            min={min} max={max} step={step}
            value={inputVal}
            disabled={disabled}
            onChange={e => setInputVal(e.target.value)}
            onBlur={() => commit(Number(inputVal))}
            onKeyDown={e => { if (e.key === 'Enter') commit(Number(inputVal)) }}
            style={{
              width: inputW, height: thumb + 4,
              background: 'var(--color-row)',
              border: '1px solid var(--color-border)',
              borderRadius: 6, padding: '0 6px',
              fontSize: font, color: 'var(--color-bright)',
              textAlign: 'center', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {unit && !label && (
            <span style={{ fontSize: font - 1, color: 'var(--color-dim)', whiteSpace: 'nowrap' }}>{unit}</span>
          )}
        </div>
      </div>

      {/* Min / Max hint */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: font - 2, color: 'var(--color-dim)' }}>
        <span>{min}{unit ? ` ${unit}` : ''}</span>
        <span>{max}{unit ? ` ${unit}` : ''}</span>
      </div>
    </div>
  )
}
