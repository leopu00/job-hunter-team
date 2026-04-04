'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type HistoryEntry = { jobTitle: string; status: string; date: number }
type Company = { id: string; name: string; sector: string; size: string; location: string; rating: number; openPositions: number; notes: string; history: HistoryEntry[] }

const SIZE_LABEL: Record<string, string> = { startup: 'Startup', small: 'Piccola', medium: 'Media', large: 'Grande', enterprise: 'Enterprise' }
const HIST_CLR: Record<string, string> = { offer: 'var(--color-green)', interview: 'var(--color-yellow)', applied: '#61affe', rejected: 'var(--color-red)', saved: 'var(--color-dim)' }

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating); const half = rating - full >= 0.5;
  return <span className="text-[10px] font-mono" style={{ color: rating >= 4 ? 'var(--color-green)' : rating >= 3 ? 'var(--color-yellow)' : 'var(--color-red)' }}>{rating.toFixed(1)}</span>;
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function CompanyRow({ c, expanded, onToggle }: { c: Company; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-[var(--color-border)]">
      <div className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-bright)] font-medium">{c.name}</p>
          <p className="text-[9px] text-[var(--color-dim)]">{c.sector} · {SIZE_LABEL[c.size] ?? c.size} · {c.location}</p>
        </div>
        <Stars rating={c.rating} />
        <span className="text-[9px] font-mono w-12 text-right" style={{ color: c.openPositions > 0 ? 'var(--color-green)' : 'var(--color-dim)' }}>{c.openPositions} pos.</span>
        <span className="text-[9px] text-[var(--color-dim)] w-10 text-right">{c.history.length > 0 ? `${c.history.length}x` : '—'}</span>
      </div>
      {expanded && (
        <div className="px-5 pb-3 pl-8">
          {c.notes && <p className="text-[10px] text-[var(--color-muted)] mb-2">{c.notes}</p>}
          {c.history.length > 0 && (
            <div>
              <p className="text-[9px] text-[var(--color-dim)] font-semibold mb-1">Storico candidature:</p>
              {c.history.map((h, i) => (
                <div key={i} className="flex items-center gap-2 ml-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: HIST_CLR[h.status] ?? 'var(--color-dim)' }} />
                  <span className="text-[9px] text-[var(--color-muted)]">{h.jobTitle}</span>
                  <span className="text-[9px]" style={{ color: HIST_CLR[h.status] ?? 'var(--color-dim)' }}>{h.status}</span>
                  <span className="text-[9px] text-[var(--color-dim)]">{timeAgo(h.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [total, setTotal] = useState(0)
  const [sectors, setSectors] = useState<string[]>([])
  const [totalPositions, setTotalPositions] = useState(0)
  const [sectorFilter, setSectorFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (sectorFilter !== 'all') params.set('sector', sectorFilter);
    if (search) params.set('q', search);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/companies${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setCompanies(data.companies ?? []); setTotal(data.total ?? 0); setSectors(data.sectors ?? []); setTotalPositions(data.totalPositions ?? 0);
  }, [sectorFilter, search])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Aziende</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Aziende</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} aziende · {totalPositions} posizioni aperte</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca azienda o settore..."
          className="text-[10px] px-3 py-1.5 rounded w-48" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }} />
        <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}
          className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          <option value="all">Tutti i settori</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">AZIENDA</span>
          <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">RATING</span>
          <span className="w-12 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">APERTE</span>
          <span className="w-10 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">STORICO</span>
        </div>
        {companies.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna azienda trovata.</p></div>
          : companies.map(c => <CompanyRow key={c.id} c={c} expanded={expandedId === c.id} onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)} />)}
      </div>
    </div>
  )
}
