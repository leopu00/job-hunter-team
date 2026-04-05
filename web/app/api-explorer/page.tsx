'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type EndpointInfo = { method: string; path: string; module: string; description: string; params?: string }

const METHOD_CLR: Record<string, { color: string; bg: string }> = {
  GET:    { color: '#61affe', bg: 'rgba(97,175,254,0.1)' },
  POST:   { color: '#49cc90', bg: 'rgba(73,204,144,0.1)' },
  PUT:    { color: '#fca130', bg: 'rgba(252,161,48,0.1)' },
  PATCH:  { color: '#50e3c2', bg: 'rgba(80,227,194,0.1)' },
  DELETE: { color: '#f93e3e', bg: 'rgba(249,62,62,0.1)' },
}

function MethodBadge({ method }: { method: string }) {
  const cfg = METHOD_CLR[method] ?? { color: 'var(--color-dim)', bg: 'transparent' };
  return <span className="text-[9px] font-bold font-mono w-14 text-center py-0.5 rounded" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}30` }}>{method}</span>;
}

function EndpointRow({ ep, expanded, onToggle }: { ep: EndpointInfo; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-[var(--color-border)]">
      <div role="button" tabIndex={0} aria-expanded={expanded} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <MethodBadge method={ep.method} />
        <span className="text-[11px] font-mono text-[var(--color-bright)] flex-1">{ep.path}</span>
        {ep.description && <span className="text-[9px] text-[var(--color-dim)] max-w-[40%] truncate">{ep.description}</span>}
      </div>
      {expanded && ep.params && (
        <div className="px-5 pb-3 pl-24">
          <pre className="text-[9px] font-mono text-[var(--color-muted)] p-2 rounded" style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)' }}>{ep.params}</pre>
        </div>
      )}
    </div>
  )
}

export default function ApiExplorerPage() {
  const [grouped, setGrouped] = useState<Record<string, EndpointInfo[]>>({})
  const [modules, setModules] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [moduleFilter, setModuleFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (moduleFilter !== 'all') params.set('module', moduleFilter);
    if (methodFilter !== 'all') params.set('method', methodFilter);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/api-explorer${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setGrouped(data.grouped ?? {}); setModules(data.modules ?? []); setTotal(data.total ?? 0);
  }, [moduleFilter, methodFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const METHODS = ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const filteredGroups = Object.entries(grouped).map(([mod, eps]) => {
    const filtered = search ? eps.filter(e => e.path.includes(search) || e.description?.includes(search)) : eps;
    return [mod, filtered] as [string, EndpointInfo[]];
  }).filter(([, eps]) => eps.length > 0);

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">API Explorer</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">API Explorer</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} endpoint · {modules.length} moduli</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca endpoint..."
          className="text-[10px] px-3 py-1.5 rounded w-48" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }} />
        <div className="flex gap-1">
          {METHODS.map(m => (
            <button key={m} onClick={() => setMethodFilter(m)}
              className="px-2 py-1 rounded text-[9px] font-bold font-mono cursor-pointer transition-colors"
              style={{ background: methodFilter === m ? 'var(--color-row)' : 'transparent', color: methodFilter === m ? (METHOD_CLR[m]?.color ?? 'var(--color-bright)') : 'var(--color-dim)', border: `1px solid ${methodFilter === m ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {m === 'all' ? 'TUTTI' : m}
            </button>
          ))}
        </div>
        <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}
          className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          <option value="all">Tutti i moduli</option>
          {modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {filteredGroups.map(([mod, eps]) => (
        <div key={mod} className="mb-4 border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          <div className="px-5 py-2 border-b border-[var(--color-border)] flex items-center gap-2" style={{ background: 'var(--color-deep)' }}>
            <span className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase">{mod}</span>
            <span className="text-[9px] text-[var(--color-dim)]">({eps.length})</span>
          </div>
          {eps.map((ep, i) => {
            const key = `${ep.method}-${ep.path}-${i}`;
            return <EndpointRow key={key} ep={ep} expanded={expandedKey === key} onToggle={() => setExpandedKey(expandedKey === key ? null : key)} />;
          })}
        </div>
      ))}
      {filteredGroups.length === 0 && <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun endpoint trovato.</p></div>}
    </div>
  )
}
