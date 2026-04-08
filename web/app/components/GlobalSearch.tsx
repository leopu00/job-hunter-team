'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type Item = { id: string; label: string; detail: string; href: string; category: string }

const ITEMS: Item[] = [
  { id: 'dashboard',    label: 'Dashboard',      detail: 'Panoramica sistema',                category: 'Pagine' },
  { id: 'positions',    label: 'Posizioni',      detail: 'Offerte trovate e filtri',           category: 'Pagine' },
  { id: 'applications', label: 'Candidature',    detail: 'CV e cover letter generate',         category: 'Pagine' },
  { id: 'ready',        label: 'Pronte',         detail: 'Candidature pronte per invio',       category: 'Pagine' },
  { id: 'risposte',     label: 'Risposte',       detail: 'Risposte ricevute',                  category: 'Pagine' },
  { id: 'crescita',     label: 'Crescita',       detail: 'Statistiche e conversion rate',      category: 'Pagine' },
  { id: 'profile',      label: 'Profilo',        detail: 'Il tuo profilo candidato',           category: 'Pagine' },
  { id: 'team',         label: 'Team',           detail: 'Agenti e stato online',              category: 'Pagine' },
  { id: 'assistente',   label: 'Assistente',     detail: 'Chat AI per assistenza',             category: 'Pagine' },
  { id: 'agents',       label: 'Agenti',         detail: 'Lista e stato agenti',               category: 'Pagine' },
  { id: 'tasks',        label: 'Task',           detail: 'Task in esecuzione e storico',       category: 'Pagine' },
  { id: 'sessions',     label: 'Sessioni',       detail: 'Sessioni e chat',                    category: 'Pagine' },
  { id: 'queue',        label: 'Queue',          detail: 'Job queue e dead-letter',            category: 'Pagine' },
  { id: 'events',       label: 'Events',         detail: 'Stream SSE real-time',               category: 'Pagine' },
  { id: 'logs',         label: 'Logs',           detail: 'Log strutturati con filtri',         category: 'Pagine' },
  { id: 'analytics',   label: 'Analytics',      detail: 'Token, costi, latenza p95',          category: 'Pagine' },
  { id: 'budget',       label: 'Budget API',     detail: 'Consumo API e proiezione',           category: 'Pagine' },
  { id: 'sentinel',    label: 'Sentinel',       detail: 'Dashboard Vigil throttle',           category: 'Pagine' },
  { id: 'forum',        label: 'Forum',          detail: 'Messaggi team con menzioni',         category: 'Pagine' },
  { id: 'audit',        label: 'Audit Log',      detail: 'Azioni critiche con severity',       category: 'Pagine' },
  { id: 'reports',      label: 'Reports',        detail: 'Generazione report e CSV',           category: 'Pagine' },
  { id: 'integrations', label: 'Integrazioni',   detail: 'Telegram, GitHub, LinkedIn…',        category: 'Pagine' },
  { id: 'project',      label: 'Progetto',       detail: 'Panoramica repository open source',   category: 'Pagine' },
  { id: 'terms',        label: 'Termini',        detail: 'Termini di servizio e licenza',      category: 'Pagine' },
  { id: 'settings',     label: 'Impostazioni',   detail: 'General, Notifiche, Sicurezza',      category: 'Config' },
  { id: 'credentials',  label: 'Credenziali',    detail: 'API key e OAuth',                    category: 'Config' },
  { id: 'providers',    label: 'Provider',       detail: 'Provider AI configurati',            category: 'Config' },
  { id: 'channels',     label: 'Canali',         detail: 'Canali notifica',                    category: 'Config' },
  { id: 'deploy',       label: 'Deploy',         detail: 'Stato servizi e daemon',             category: 'Sistema' },
  { id: 'gateway',      label: 'Gateway',        detail: 'Canali e pipeline middleware',       category: 'Sistema' },
  { id: 'health',       label: 'Health',         detail: 'Semafori 7 moduli',                  category: 'Sistema' },
  { id: 'validators',   label: 'Validators',     detail: 'Schemi Zod registrati',              category: 'Sistema' },
  { id: 'skills',       label: 'Skills',         detail: 'Script disponibili',                 category: 'Sistema' },
].map(i => ({ ...i, href: `/${i.id}` }))

const RECENT_KEY = 'jht:search:recent'
const MAX_RECENT = 5

function fuzzy(query: string, target: string): { match: boolean; indices: number[] } {
  const q = query.toLowerCase(), t = target.toLowerCase()
  const indices: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { indices.push(ti); qi++ }
  }
  return { match: qi === q.length, indices }
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  const set = new Set(indices)
  return (
    <span>
      {text.split('').map((ch, i) =>
        set.has(i)
          ? <span key={i} style={{ color: 'var(--color-green)', fontWeight: 700 }}>{ch}</span>
          : <span key={i}>{ch}</span>
      )}
    </span>
  )
}

export function GlobalSearch() {
  const [open,     setOpen]     = useState(false)
  const [query,    setQuery]    = useState('')
  const [selected, setSelected] = useState(0)
  const [recent,   setRecent]   = useState<Item[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const router   = useRouter()

  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')) } catch { /* ignore */ }
  }, [])

  const openSearch = useCallback(() => { setOpen(true); setQuery(''); setSelected(0) }, [])
  const closeSearch = useCallback(() => { setOpen(false); setQuery('') }, [])

  useEffect(() => {
    const onSearch = () => openSearch()
    const onKey    = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openSearch() }
      if (e.key === 'Escape' && open) closeSearch()
    }
    document.addEventListener('jht:search' as never, onSearch)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('jht:search' as never, onSearch); document.removeEventListener('keydown', onKey) }
  }, [open, openSearch, closeSearch])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])

  const results: Array<Item & { indices: number[] }> = query.length < 1
    ? []
    : ITEMS.map(item => {
        const { match, indices } = fuzzy(query, item.label + ' ' + item.detail)
        return match ? { ...item, indices } : null
      }).filter((x): x is Item & { indices: number[] } => x !== null)

  const displayList = results.length > 0 ? results : (query ? [] : recent.map(r => ({ ...r, indices: [] })))
  const showRecent  = query.length === 0 && recent.length > 0

  const execute = useCallback((item: Item) => {
    setRecent(prev => {
      const next = [item, ...prev.filter(r => r.id !== item.id)].slice(0, MAX_RECENT)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
    closeSearch()
    router.push(item.href)
  }, [closeSearch, router])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, displayList.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && displayList[selected]) { e.preventDefault(); execute(displayList[selected]) }
  }

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-label="Ricerca globale" className="fixed inset-0 flex items-start justify-center pt-[10vh] px-4 z-[9990]"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', animation: 'fade-in 0.1s ease both' }}
      onClick={e => { if (e.target === e.currentTarget) closeSearch() }}>
      <div className="w-full max-w-xl rounded-xl overflow-hidden"
        style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>

        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span style={{ color: 'var(--color-dim)', fontSize: 14 }} aria-hidden="true">🔍</span>
          <input ref={inputRef} value={query} placeholder="Cerca pagine, sezioni…"
            role="combobox" aria-label="Cerca pagine e sezioni" aria-expanded={displayList.length > 0} aria-controls="search-listbox" aria-activedescendant={displayList[selected] ? `search-item-${displayList[selected].id}` : undefined} aria-autocomplete="list"
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={onKey}
            className="flex-1 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] rounded text-[13px]"
            style={{ color: 'var(--color-bright)' }} />
          <kbd className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-dim)' }}>esc</kbd>
        </div>

        <div id="search-listbox" role="listbox" className="overflow-y-auto" style={{ maxHeight: '55vh' }}>
          {showRecent && <p className="px-4 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>Recenti</p>}
          {displayList.length === 0 && query.length > 0 && (
            <p className="px-4 py-6 text-[11px] text-center" style={{ color: 'var(--color-dim)' }}>Nessun risultato per &ldquo;{query}&rdquo;</p>
          )}
          {displayList.map((item, i) => (
            <button key={item.id} id={`search-item-${item.id}`} role="option" aria-selected={i === selected} onClick={() => execute(item)} onMouseEnter={() => setSelected(i)}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-left cursor-pointer transition-colors"
              style={{ background: i === selected ? 'var(--color-deep)' : 'transparent', border: 'none' }}>
              <span className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold shrink-0 w-14 text-center"
                style={{ background: 'var(--color-card)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>
                {item.category}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-bright)' }}>
                  {item.indices.length > 0 ? <Highlighted text={item.label} indices={item.indices.filter(idx => idx < item.label.length)} /> : item.label}
                </p>
                <p className="text-[10px] truncate" style={{ color: 'var(--color-dim)' }}>{item.detail}</p>
              </div>
              <span style={{ color: 'var(--color-dim)', fontSize: 10 }}>↵</span>
            </button>
          ))}
        </div>

        <p className="px-4 py-2 text-[9px] border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-dim)' }}>
          ↑↓ naviga · ↵ apri · Esc chiudi
        </p>
      </div>
    </div>
  )
}
