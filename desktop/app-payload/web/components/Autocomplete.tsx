'use client'

import { useEffect, useRef, useState } from 'react'

export interface ACOption { value: string; label: string; [key: string]: unknown }

export interface AutocompleteProps {
  /** Opzioni statiche — se fornito non serve onSearch */
  options?: ACOption[]
  /** Async loader — riceve query, restituisce opzioni */
  onSearch?: (query: string) => Promise<ACOption[]>
  onSelect?: (option: ACOption) => void
  placeholder?: string
  debounce?: number
  disabled?: boolean
  /** Numero minimo caratteri prima di cercare */
  minChars?: number
  width?: number | string
  noResultsText?: string
}

/* Evidenzia la parte che fa match */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <strong style={{ color: 'var(--color-green,#00e87a)', fontWeight: 700 }}>
        {text.slice(idx, idx + query.length)}
      </strong>
      {text.slice(idx + query.length)}
    </>
  )
}

export default function Autocomplete({
  options: staticOpts, onSearch, onSelect,
  placeholder = 'Cerca…', debounce = 250,
  disabled = false, minChars = 1, width = '100%',
  noResultsText = 'Nessun risultato',
}: AutocompleteProps) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<ACOption[]>([])
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef   = useRef<HTMLInputElement>(null)
  const listRef    = useRef<HTMLDivElement>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  /* Click esterno */
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!containerRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  /* Scroll active item in view */
  useEffect(() => {
    if (activeIdx < 0) return
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const search = (q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (q.length < minChars) { setResults([]); setOpen(false); return }

    timerRef.current = setTimeout(async () => {
      if (staticOpts) {
        const filtered = staticOpts.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
        setResults(filtered); setOpen(true)
      } else if (onSearch) {
        setLoading(true)
        try {
          const res = await onSearch(q)
          setResults(res); setOpen(true)
        } finally { setLoading(false) }
      }
      setActiveIdx(-1)
    }, debounce)
  }

  const select = (opt: ACOption) => {
    setQuery(opt.label)
    setOpen(false)
    setResults([])
    setActiveIdx(-1)
    onSelect?.(opt)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); if (activeIdx >= 0) select(results[activeIdx]) }
    if (e.key === 'Escape')    { setOpen(false); setActiveIdx(-1) }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width }}>
      {/* Input */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => { setQuery(e.target.value); search(e.target.value) }}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          onKeyDown={handleKey}
          style={{
            width: '100%', boxSizing: 'border-box',
            height: 38, padding: '0 36px 0 12px',
            background: 'var(--color-row)',
            border: `1px solid ${open ? 'var(--color-green,#00e87a)' : 'var(--color-border)'}`,
            borderRadius: 8, fontSize: 13,
            color: 'var(--color-bright)', outline: 'none',
            opacity: disabled ? 0.5 : 1,
            transition: 'border-color 0.15s',
          }}
        />
        {/* Spinner / clear */}
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--color-dim)', pointerEvents: loading ? 'none' : 'auto', cursor: query ? 'pointer' : 'default' }}
          onClick={() => { if (query) { setQuery(''); setResults([]); setOpen(false); inputRef.current?.focus() } }}>
          {loading ? '⏳' : query ? '×' : '🔍'}
        </span>
      </div>

      {/* Dropdown */}
      {open && (
        <div ref={listRef} role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999,
          background: 'var(--color-panel)', border: '1px solid var(--color-border)',
          borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)', maxHeight: 240, overflowY: 'auto',
        }}>
          {results.length === 0
            ? <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--color-dim)', textAlign: 'center' }}>{noResultsText}</div>
            : results.map((opt, i) => (
                <div
                  key={opt.value}
                  role="option" aria-selected={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => select(opt)}
                  style={{
                    padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                    background: i === activeIdx ? 'color-mix(in srgb,var(--color-green,#00e87a) 10%,transparent)' : 'transparent',
                    color: 'var(--color-bright)', transition: 'background 0.1s',
                  }}>
                  <Highlight text={opt.label} query={query} />
                </div>
              ))
          }
        </div>
      )}
    </div>
  )
}
