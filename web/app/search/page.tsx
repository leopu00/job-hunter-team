'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

type ResultType = 'page' | 'agent' | 'session' | 'task' | 'plugin'
type SearchResult = { type: ResultType; id: string; title: string; detail: string; href: string }
type SearchRes    = { results: SearchResult[]; query: string; total: number }

const TYPE_ICON: Record<ResultType, string> = {
  page: '📄', agent: '🤖', session: '💬', task: '📋', plugin: '🔌',
}
const TYPE_LABEL: Record<ResultType, string> = {
  page: 'Pagina', agent: 'Agente', session: 'Sessione', task: 'Task', plugin: 'Plugin',
}
const TYPE_COLOR: Record<ResultType, string> = {
  page: 'var(--color-muted)', agent: 'var(--color-green)', session: 'var(--color-yellow)',
  task: 'var(--color-orange)', plugin: 'var(--color-dim)',
}

function groupByType(results: SearchResult[]): Record<string, SearchResult[]> {
  const order: ResultType[] = ['page', 'agent', 'task', 'session', 'plugin']
  const groups: Record<string, SearchResult[]> = {}
  for (const type of order) {
    const items = results.filter(r => r.type === type)
    if (items.length > 0) groups[type] = items
  }
  return groups
}

export default function SearchPage() {
  const [query, setQuery]       = useState('')
  const [data, setData]         = useState<SearchRes | null>(null)
  const [loading, setLoading]   = useState(false)
  const inputRef                = useRef<HTMLInputElement>(null)
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setData(null); setLoading(false); return }
    setLoading(true)
    const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`).catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  const onChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 280)
  }

  const groups = data ? groupByType(data.results) : {}
  const hasResults = data && data.results.length > 0
  const noResults  = data && data.results.length === 0

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Ricerca</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Ricerca globale</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Cerca tra pagine, agenti, sessioni, task e plugin.</p>
      </div>

      {/* Search input */}
      <div className="relative mb-6">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-dim)] text-sm pointer-events-none">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => onChange(e.target.value)}
          aria-label="Cerca nel sito"
          placeholder="Cerca qualcosa… (min 2 caratteri)"
          aria-label="Cerca nel dashboard"
          className="w-full pl-10 pr-4 py-3 text-[13px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)]"
          style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', color: 'var(--color-bright)' }}
        />
        {loading && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-dim)] text-[10px]" role="status" aria-live="polite">…</span>}
      </div>

      {/* Empty state iniziale */}
      {!data && !loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="text-4xl" aria-hidden="true">🔍</span>
          <p className="text-[12px] text-[var(--color-dim)]">Digita per cercare nel dashboard</p>
        </div>
      )}

      {/* No results */}
      {noResults && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="text-4xl" aria-hidden="true">📭</span>
          <p className="text-[12px] font-semibold text-[var(--color-muted)]">Nessun risultato per &ldquo;{data.query}&rdquo;</p>
        </div>
      )}

      {/* Risultati raggruppati */}
      {hasResults && (
        <div className="flex flex-col gap-6">
          <p className="text-[10px] text-[var(--color-dim)]">{data.total} risultati per &ldquo;{data.query}&rdquo;</p>
          {Object.entries(groups).map(([type, items]) => (
            <div key={type}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{TYPE_ICON[type as ResultType]}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: TYPE_COLOR[type as ResultType] }}>
                  {TYPE_LABEL[type as ResultType]} ({items.length})
                </span>
              </div>
              <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
                {items.map((r, i) => (
                  <Link key={r.id} href={r.href}
                    className="flex items-center gap-4 px-5 py-3 no-underline transition-colors hover:bg-[var(--color-row)]"
                    style={{ borderBottom: i < items.length - 1 ? '1px solid var(--color-border)' : 'none', display: 'flex' }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-[var(--color-bright)] truncate">{r.title}</p>
                      <p className="text-[10px] text-[var(--color-dim)] truncate mt-0.5">{r.detail}</p>
                    </div>
                    <span className="text-[10px] text-[var(--color-border)] flex-shrink-0">→</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
