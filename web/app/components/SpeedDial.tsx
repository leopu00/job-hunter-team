'use client'

import { useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface SpeedDialAction {
  icon:     string
  label:    string
  onClick:  () => void
  color?:   string     // override colore mini-button
  disabled?: boolean
}

export interface SpeedDialProps {
  actions:    SpeedDialAction[]
  icon?:      string    // icona FAB principale, default '+'
  iconOpen?:  string    // icona quando aperto, default '✕'
  direction?: 'up' | 'down' | 'left' | 'right'
  position?:  'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'relative'
  color?:     string    // colore FAB principale
  size?:      number    // px FAB, default 52
  className?: string
}

// ── Animations ─────────────────────────────────────────────────────────────

const STYLE = `
@keyframes sd-in  { from { opacity:0; transform: scale(0.5) } to { opacity:1; transform: scale(1) } }
@keyframes sd-rot { from { transform: rotate(0deg) } to { transform: rotate(135deg) } }
`

// ── Position helpers ───────────────────────────────────────────────────────

const POS_STYLE: Record<NonNullable<SpeedDialProps['position']>, React.CSSProperties> = {
  'bottom-right': { position: 'fixed', bottom: 24, right: 24, zIndex: 50 },
  'bottom-left':  { position: 'fixed', bottom: 24, left:  24, zIndex: 50 },
  'top-right':    { position: 'fixed', top:    24, right: 24, zIndex: 50 },
  'top-left':     { position: 'fixed', top:    24, left:  24, zIndex: 50 },
  'relative':     { position: 'relative' },
}

function itemOffset(direction: NonNullable<SpeedDialProps['direction']>, idx: number, gap: number): React.CSSProperties {
  const d = (idx + 1) * gap
  if (direction === 'up')    return { bottom: d, left: '50%', transform: 'translateX(-50%)' }
  if (direction === 'down')  return { top:    d, left: '50%', transform: 'translateX(-50%)' }
  if (direction === 'left')  return { right:  d, top:  '50%', transform: 'translateY(-50%)' }
                             return { left:   d, top:  '50%', transform: 'translateY(-50%)' }
}

const labelSide: Record<NonNullable<SpeedDialProps['direction']>, React.CSSProperties> = {
  up:    { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 8 },
  down:  { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 8 },
  left:  { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4 },
  right: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4 },
}

// ── SpeedDial ──────────────────────────────────────────────────────────────

export function SpeedDial({
  actions, icon = '+', iconOpen = '✕',
  direction = 'up', position = 'bottom-right',
  color = 'var(--color-green)', size = 52, className = '',
}: SpeedDialProps) {
  const [open, setOpen] = useState(false)
  const [tip,  setTip]  = useState<number | null>(null)
  const ref             = useRef<HTMLDivElement>(null)
  const gap             = size + 12

  // Chiude su click esterno
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // ESC chiude
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  return (
    <>
      <style>{STYLE}</style>
      <div ref={ref} style={{ ...POS_STYLE[position], display: 'inline-block' }} className={className}>

        {/* Actions */}
        {open && actions.map((action, i) => (
          <div key={i} style={{ position: 'absolute', ...itemOffset(direction, i, gap),
            animation: `sd-in 0.15s ease ${i * 0.04}s both` }}>

            {/* Label tooltip */}
            {tip === i && (
              <div style={{ position: 'absolute', ...labelSide[direction],
                background: 'var(--color-deep)', border: '1px solid var(--color-border)',
                borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                <span style={{ fontSize: 9, color: 'var(--color-bright)', fontFamily: 'var(--font-mono)' }}>
                  {action.label}
                </span>
              </div>
            )}

            {/* Mini button */}
            <button
              type="button"
              disabled={action.disabled}
              onClick={() => { action.onClick(); setOpen(false) }}
              onMouseEnter={() => setTip(i)}
              onMouseLeave={() => setTip(null)}
              aria-label={action.label}
              style={{ width: size * 0.72, height: size * 0.72, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: action.color ?? 'var(--color-card)',
                border: `1px solid ${action.color ?? 'var(--color-border)'}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.35)', cursor: action.disabled ? 'not-allowed' : 'pointer',
                fontSize: 16, opacity: action.disabled ? 0.45 : 1, transition: 'transform .15s',
              }}
              onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)' }}
              onMouseUp={e   => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}>
              {action.icon}
            </button>
          </div>
        ))}

        {/* FAB principale */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Chiudi menu' : 'Apri menu azioni'}
          aria-expanded={open}
          style={{ width: size, height: size, borderRadius: '50%', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: color, border: 'none',
            boxShadow: open ? `0 0 0 4px color-mix(in srgb, ${color} 25%, transparent), 0 6px 20px rgba(0,0,0,0.4)` : '0 4px 16px rgba(0,0,0,0.4)',
            fontSize: 22, fontWeight: 700, color: '#000', transition: 'box-shadow .2s',
            transform: 'translateZ(0)',
          }}>
          <span style={{ display: 'inline-block', transition: 'transform .25s',
            transform: open ? 'rotate(135deg)' : 'rotate(0deg)' }}>
            {open ? iconOpen : icon}
          </span>
        </button>
      </div>
    </>
  )
}
