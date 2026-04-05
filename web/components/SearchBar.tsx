'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type SearchResult = { type: string; id: string; title: string; detail: string; href: string }

const TYPE_LABELS: Record<string, string> = {
  page: 'Pagina', agent: 'Agente', session: 'Sessione', task: 'Task', plugin: 'Plugin',
}
const TYPE_COLORS: Record<string, string> = {
  page: 'var(--color-blue)', agent: 'var(--color-green)', session: 'var(--color-cyan)',
  task: 'var(--color-yellow)', plugin: 'var(--color-magenta)',
}

export default function SearchBar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(-1)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return }
    setLoading(true)
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      setResults(data.results ?? [])
      setOpen(data.results?.length > 0)
    }
    setLoading(false)
  }, [])

  function handleChange(val: string) {
    setQuery(val)
    setSelected(-1)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(val), 200)
  }

  function navigate(href: string) {
    setOpen(false); setQuery(''); setResults([])
    router.push(href)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && selected >= 0 && results[selected]) { e.preventDefault(); navigate(results[selected].href) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    function handleShortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus() }
    }
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <input ref={inputRef} type="text" value={query} onChange={e => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)} onKeyDown={handleKeyDown}
          placeholder="Cerca... (⌘K)"
          className="w-full px-3 py-1.5 pl-8 rounded text-[11px] bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-bright)] placeholder:text-[var(--color-dim)] outline-none focus:border-[var(--color-border-glow)] transition-colors" />
        <svg aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" fill="none" stroke="var(--color-dim)" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        {loading && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-[var(--color-dim)] border-t-transparent animate-spin" />}
      </div>

      {open && results.length > 0 && (
        <div role="listbox" className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] shadow-lg overflow-hidden z-50"
          style={{ animation: 'fade-in 0.15s ease both' }}>
          {results.map((r, i) => {
            const color = TYPE_COLORS[r.type] ?? 'var(--color-dim)'
            return (
              <button key={`${r.type}-${r.id}`} role="option" aria-selected={selected === i} onClick={() => navigate(r.href)}
                onMouseEnter={() => setSelected(i)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-left cursor-pointer transition-colors"
                style={{ background: selected === i ? 'var(--color-row)' : 'transparent' }}>
                <span className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold shrink-0"
                  style={{ background: `${color}22`, color }}>{TYPE_LABELS[r.type] ?? r.type}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-[var(--color-bright)] truncate" title={r.title}>{r.title}</p>
                  <p className="text-[9px] text-[var(--color-dim)] truncate" title={r.detail}>{r.detail}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
