'use client'

import { useEffect, useRef, useState } from 'react'

export interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  /** Label trigger — es. nome del tag */
  label?: string
  disabled?: boolean
}

const PALETTE = [
  '#00e87a','#4ade80','#22d3ee','#60a5fa','#818cf8','#a78bfa',
  '#f472b6','#fb7185','#f87171','#fb923c','#facc15','#e2e8f0',
]

function isValidHex(v: string) { return /^#[0-9a-fA-F]{6}$/.test(v) }

function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return (r*299 + g*587 + b*114) / 1000 > 128 ? '#000' : '#fff'
}

export default function ColorPicker({ value, onChange, label, disabled = false }: ColorPickerProps) {
  const [open, setOpen]       = useState(false)
  const [hex, setHex]         = useState(value)
  const [hexError, setHexError] = useState(false)
  const containerRef          = useRef<HTMLDivElement>(null)

  // Sincronizza input hex con value esterno
  useEffect(() => { setHex(value) }, [value])

  // Chiudi su click fuori
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!containerRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const select = (color: string) => { onChange(color); setHex(color); setHexError(false); setOpen(false) }

  const handleHexChange = (v: string) => {
    setHex(v)
    if (isValidHex(v)) { setHexError(false); onChange(v) }
    else setHexError(true)
  }

  const handleHexBlur = () => {
    if (!isValidHex(hex)) { setHex(value); setHexError(false) }
  }

  const safeColor = isValidHex(value) ? value : '#00e87a'

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Trigger */}
      <button
        aria-expanded={open}
        aria-label="Seleziona colore"
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', borderRadius: 8,
          border: `1px solid ${open ? safeColor : 'var(--color-border)'}`,
          background: 'var(--color-panel)',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'border-color 0.2s',
        }}>
        {/* Swatch preview */}
        <span style={{
          display: 'inline-block', width: 16, height: 16, borderRadius: 4,
          background: safeColor, flexShrink: 0,
          boxShadow: `0 0 0 1px rgba(0,0,0,0.2)`,
        }} />
        {label && <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{label}</span>}
        <span style={{ fontSize: 10, color: 'var(--color-dim)', fontFamily: 'monospace' }}>{safeColor}</span>
        <span style={{ fontSize: 8, color: 'var(--color-dim)', marginLeft: 2 }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 50,
          background: 'var(--color-panel)', border: '1px solid var(--color-border)',
          borderRadius: 10, padding: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
          minWidth: 188, animation: 'fade-in 0.1s ease both',
        }}>
          {/* Palette */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6, marginBottom: 10 }}>
            {PALETTE.map(color => (
              <button
                key={color}
                onClick={() => select(color)}
                title={color}
                style={{
                  width: 24, height: 24, borderRadius: 6, border: 'none',
                  background: color, cursor: 'pointer',
                  outline: value === color ? `2px solid #fff` : 'none',
                  outlineOffset: 2,
                  boxShadow: value === color ? `0 0 0 3px ${color}55` : '0 1px 3px rgba(0,0,0,0.3)',
                  transform: value === color ? 'scale(1.15)' : 'scale(1)',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                }}
              />
            ))}
          </div>

          {/* Separatore */}
          <div style={{ height: 1, background: 'var(--color-border)', marginBottom: 10 }} />

          {/* Custom hex */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Mini swatch live */}
            <span style={{
              width: 20, height: 20, borderRadius: 4, flexShrink: 0,
              background: isValidHex(hex) ? hex : 'var(--color-border)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              display: 'inline-block',
            }} />
            <input
              type="text"
              value={hex}
              onChange={e => handleHexChange(e.target.value)}
              onBlur={handleHexBlur}
              maxLength={7}
              placeholder="#000000"
              style={{
                flex: 1, fontSize: 11, fontFamily: 'monospace',
                padding: '4px 8px', borderRadius: 6,
                border: `1px solid ${hexError ? 'var(--color-red)' : 'var(--color-border)'}`,
                background: 'var(--color-row)', color: 'var(--color-bright)',
                outline: 'none',
              }}
            />
            {/* Conferma hex */}
            <button
              onClick={() => { if (isValidHex(hex)) select(hex) }}
              disabled={hexError || !isValidHex(hex)}
              style={{
                padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                border: 'none', cursor: hexError ? 'default' : 'pointer',
                background: !hexError && isValidHex(hex) ? safeColor : 'var(--color-border)',
                color: !hexError && isValidHex(hex) ? contrastColor(safeColor) : 'var(--color-dim)',
                transition: 'background 0.15s',
              }}>
              ✓
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
