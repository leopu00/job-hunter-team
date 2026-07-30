'use client'

import { useEffect, useRef, useState } from 'react'

export interface PinInputProps {
  length?: 4 | 5 | 6
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  onComplete?: (value: string) => void
  masked?: boolean
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_MAP = {
  sm: { cell: 36, font: 16, gap: 6  },
  md: { cell: 46, font: 20, gap: 8  },
  lg: { cell: 56, font: 24, gap: 10 },
}

export default function PinInput({
  length = 4, value: ctrl, defaultValue = '', onChange, onComplete,
  masked = false, disabled = false, invalid = false,
  autoFocus = false, size = 'md',
}: PinInputProps) {
  const isCtrl = ctrl !== undefined
  const [internal, setInternal] = useState(defaultValue.slice(0, length))
  const digits  = (isCtrl ? ctrl! : internal).slice(0, length).padEnd(length, '')
  const refs    = useRef<(HTMLInputElement | null)[]>([])
  const { cell, font, gap } = SIZE_MAP[size]

  useEffect(() => { if (autoFocus) refs.current[0]?.focus() }, [autoFocus])

  const commit = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, length)
    if (!isCtrl) setInternal(clean)
    onChange?.(clean)
    if (clean.length === length) onComplete?.(clean)
    return clean
  }

  const focus = (idx: number) => refs.current[Math.max(0, Math.min(idx, length - 1))]?.focus()

  const handleChange = (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    if (!raw) {
      const next = digits.slice(0, i) + '' + digits.slice(i + 1)
      commit(next.trimEnd())
      return
    }
    // prende solo l'ultimo digit digitato
    const ch   = raw[raw.length - 1]
    const next = (digits.slice(0, i) + ch + digits.slice(i + 1)).slice(0, length)
    commit(next)
    if (i < length - 1) focus(i + 1)
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[i]) {
        const next = digits.slice(0, i) + '' + digits.slice(i + 1)
        commit(next.trimEnd())
      } else {
        focus(i - 1)
        const next = digits.slice(0, i - 1) + '' + digits.slice(i)
        commit(next.trimEnd())
      }
    }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); focus(i - 1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1) }
    if (e.key === 'Delete') {
      e.preventDefault()
      const next = digits.slice(0, i) + '' + digits.slice(i + 1)
      commit(next.trimEnd())
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    const clean  = commit(pasted)
    focus(Math.min(clean.length, length - 1))
  }

  const handleFocus = (i: number) => refs.current[i]?.select()

  const borderColor = (i: number) => {
    if (invalid)             return 'var(--color-red, #ff4d4d)'
    if (document.activeElement === refs.current[i]) return 'var(--color-green, #00e87a)'
    return 'var(--color-border)'
  }

  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center', gap }}
      onPaste={handlePaste}
    >
      {Array.from({ length }, (_, i) => {
        const val   = digits[i] ?? ''
        const filled = val !== ''
        return (
          <input
            key={i}
            ref={el => { refs.current[i] = el }}
            type={masked ? 'password' : 'text'}
            inputMode="numeric"
            maxLength={2}
            value={val}
            disabled={disabled}
            autoComplete="off"
            onChange={e => handleChange(i, e)}
            onKeyDown={e => handleKeyDown(i, e)}
            onFocus={() => handleFocus(i)}
            style={{
              width: cell, height: cell,
              textAlign: 'center',
              fontSize: font,
              fontWeight: 700,
              fontFamily: masked ? undefined : 'monospace',
              letterSpacing: masked ? undefined : '0.05em',
              background: filled ? 'color-mix(in srgb, var(--color-green,#00e87a) 6%, var(--color-row))' : 'var(--color-row)',
              border: `2px solid ${invalid ? 'var(--color-red,#ff4d4d)' : filled ? 'var(--color-green,#00e87a)' : 'var(--color-border)'}`,
              borderRadius: 8,
              color: 'var(--color-bright)',
              outline: 'none',
              cursor: disabled ? 'default' : 'text',
              opacity: disabled ? 0.5 : 1,
              transition: 'border-color 0.15s, background 0.15s',
              caretColor: 'transparent',
              boxSizing: 'border-box',
            }}
            onFocusCapture={e => {
              (e.target as HTMLInputElement).style.borderColor = invalid
                ? 'var(--color-red,#ff4d4d)'
                : 'var(--color-green,#00e87a)'
            }}
            onBlurCapture={e => {
              (e.target as HTMLInputElement).style.borderColor = invalid
                ? 'var(--color-red,#ff4d4d)'
                : filled ? 'var(--color-green,#00e87a)' : 'var(--color-border)'
            }}
          />
        )
      })}
    </div>
  )
}
