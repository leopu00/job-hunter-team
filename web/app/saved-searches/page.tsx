'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type SavedSearch = { id: string; name: string; query: string; filters: Record<string, string>; alertEnabled: boolean; frequency: string; newCount: number; lastRun: number; createdAt: number }

const FREQ_LABEL: Record<string, string> = { realtime: 'tempo reale', daily: 'giornaliero', weekly: 'settimanale' }

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function SearchRow({ ss, onToggle, onDelete }: { ss: SavedSearch; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
  const filters = Object.entries(ss.filters).map(([k, v]) => `${k}:${v}`).join(' · ');
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-[var(--color-bright)] font-medium truncate">{ss.name}</p>
          {ss.newCount > 0 && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-green)', color: '#000' }}>{ss.newCount} nuovi</span>}
        </div>
        <p className="text-[9px] text-[var(--color-dim)] font-mono truncate">"{ss.query}" {filters && `· ${filters}`}</p>
      </div>
      <span className="text-[9px] text-[var(--color-dim)]">{FREQ_LABEL[ss.frequency] ?? ss.frequency}</span>
      <span className="text-[9px] text-[var(--color-dim)] w-14 text-right">{timeAgo(ss.lastRun)}</span>
      <button onClick={() => onToggle(ss.id)} className="text-[9px] font-bold cursor-pointer w-8"
        style={{ color: ss.alertEnabled ? 'var(--color-green)' : 'var(--color-dim)' }}>{ss.alertEnabled ? 'ON' : 'OFF'}</button>
      <button onClick={() => onDelete(ss.id)} aria-label="Elimina ricerca salvata" className="text-[9px] font-bold cursor-pointer" style={{ color: 'var(--color-red)' }}>×</button>
    </div>
  )
}

export default function SavedSearchesPage() {
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [total, setTotal] = useState(0)
  const [totalNew, setTotalNew] = useState(0)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newQuery, setNewQuery] = useState('')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/saved-searches').catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setSearches(data.searches ?? []); setTotal(data.total ?? 0); setTotalNew(data.totalNew ?? 0);
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const toggle = async (id: string) => {
    await fetch('/api/saved-searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toggleId: id }) }).catch(() => null);
    fetchData();
  }

  const remove = async (id: string) => {
    await fetch('/api/saved-searches', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => null);
    fetchData();
  }

  const add = async () => {
    if (!newName.trim() || !newQuery.trim()) return;
    await fetch('/api/saved-searches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, query: newQuery }) }).catch(() => null);
    setNewName(''); setNewQuery(''); setAdding(false); fetchData();
  }

  const inputStyle = { background: 'var(--color-deep)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' } as const;

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Ricerche Salvate</span>
        </nav>
        <div className="flex items-center justify-between mt-3">
          <div><h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Ricerche Salvate</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} ricerche · {totalNew} nuovi risultati</p></div>
          <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>{adding ? 'Annulla' : '+ Nuova'}</button>
        </div>
      </div>

      {adding && (
        <div className="mb-4 p-4 rounded-lg flex gap-2 items-end" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
          <div className="flex flex-col gap-0.5"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">NOME</label><input value={newName} onChange={e => setNewName(e.target.value)} className="text-[10px] px-2 py-1.5 rounded w-40" style={inputStyle} /></div>
          <div className="flex flex-col gap-0.5 flex-1"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">QUERY</label><input value={newQuery} onChange={e => setNewQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} className="text-[10px] px-2 py-1.5 rounded" style={inputStyle} /></div>
          <button onClick={add} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>Salva</button>
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">RICERCA</span>
          <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">FREQ.</span>
          <span className="w-14 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">ULTIMO</span>
          <span className="w-8 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-center">ALERT</span>
          <span className="w-4" />
        </div>
        {searches.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna ricerca salvata.</p></div>
          : searches.map(ss => <SearchRow key={ss.id} ss={ss} onToggle={toggle} onDelete={remove} />)}
      </div>
    </div>
  )
}
