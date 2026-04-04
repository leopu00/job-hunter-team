'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  placeholder?: string
  maxTags?: number
  /** Separatori oltre Enter: default include virgola */
  separators?: string[]
  disabled?: boolean
}

export default function TagInput({
  value: tags, onChange, suggestions = [], placeholder = 'Aggiungi tag…',
  maxTags = 20, separators = [','], disabled = false,
}: TagInputProps) {
  const [input, setInput]       = useState('')
  const [open, setOpen]         = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = suggestions.filter(s =>
    s.toLowerCase().includes(input.toLowerCase().trim()) && !tags.includes(s)
  ).slice(0, 8)

  const addTag = useCallback((raw: string) => {
    const tag = raw.trim().replace(/,+$/, '').trim()
    if (!tag || tags.includes(tag) || tags.length >= maxTags) return
    onChange([...tags, tag])
    setInput('')
    setOpen(false)
    setFocusIdx(-1)
  }, [tags, onChange, maxTags])

  const removeTag = useCallback((idx: number) => {
    onChange(tags.filter((_, i) => i !== idx))
  }, [tags, onChange])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (focusIdx >= 0 && filtered[focusIdx]) {
        addTag(filtered[focusIdx]!)
      } else if (input.trim()) {
        addTag(input)
      }
      return
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags.length - 1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx(i => Math.min(i + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx(i => Math.max(i - 1, -1))
      return
    }
    if (e.key === 'Escape') { setOpen(false); setFocusIdx(-1) }
  }

  const handleChange = (val: string) => {
    // Aggiunta con separatore (virgola)
    for (const sep of separators) {
      if (val.includes(sep)) {
        const parts = val.split(sep)
        parts.slice(0, -1).forEach(p => addTag(p))
        setInput(parts[parts.length - 1] ?? '')
        setOpen(true)
        return
      }
    }
    setInput(val)
    setOpen(val.trim().length > 0)
    setFocusIdx(-1)
  }

  // Chiudi dropdown se click fuori
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const atMax = tags.length >= maxTags

  return (
    <div ref={containerRef} className="relative">
      {/* Tag container + input */}
      <div
        onClick={() => !disabled && inputRef.current?.focus()}
        className="flex flex-wrap gap-1.5 min-h-[38px] cursor-text rounded-lg p-2"
        style={{ background: 'var(--color-bg)', border: `1px solid var(--color-border)`, transition: 'border-color 0.15s' }}
        onFocus={() => {}} // handled by input
      >
        {tags.map((tag, i) => (
          <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono"
            style={{ background: 'rgba(0,232,122,0.1)', border: '1px solid rgba(0,232,122,0.25)', color: 'var(--color-green)' }}>
            {tag}
            {!disabled && (
              <button onClick={() => removeTag(i)} className="cursor-pointer text-[10px] leading-none hover:text-red-400 transition-colors"
                style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, lineHeight: 1 }}>
                ×
              </button>
            )}
          </span>
        ))}
        {!atMax && !disabled && (
          <input
            ref={inputRef}
            value={input}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => input.trim() && setOpen(true)}
            placeholder={tags.length === 0 ? placeholder : ''}
            className="flex-1 min-w-24 bg-transparent outline-none text-[11px]"
            style={{ color: 'var(--color-bright)', minWidth: 80 }}
          />
        )}
        {/* Count */}
        {maxTags < 100 && (
          <span className="ml-auto text-[9px] self-center flex-shrink-0" style={{ color: atMax ? 'var(--color-red)' : 'var(--color-dim)' }}>
            {tags.length}/{maxTags}
          </span>
        )}
      </div>

      {/* Dropdown suggerimenti */}
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
          {filtered.map((s, i) => (
            <button key={s}
              onMouseDown={e => { e.preventDefault(); addTag(s) }}
              className="w-full text-left px-3 py-2 text-[11px] cursor-pointer transition-colors"
              style={{ background: i === focusIdx ? 'var(--color-row)' : 'transparent', color: 'var(--color-muted)', border: 'none', display: 'block' }}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
