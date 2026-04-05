'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Job = { id: string; title: string; company: string; location: string; salaryMin: number; salaryMax: number; currency: string; status: string; source: string; addedAt: number; updatedAt: number }

const STATUS_CFG: Record<string, { color: string; bg: string; label: string }> = {
  saved:     { color: 'var(--color-dim)',    bg: 'transparent',           label: 'salvato' },
  applied:   { color: '#61affe',             bg: 'rgba(97,175,254,0.08)', label: 'candidato' },
  interview: { color: 'var(--color-yellow)', bg: 'rgba(255,193,7,0.08)',  label: 'colloquio' },
  rejected:  { color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.08)',  label: 'rifiutato' },
  offer:     { color: 'var(--color-green)',  bg: 'rgba(0,200,83,0.08)',   label: 'offerta' },
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function salary(min: number, max: number, cur: string): string {
  const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
  return `${fmt(min)}–${fmt(max)} ${cur}`;
}

function JobRow({ j }: { j: Job }) {
  const cfg = STATUS_CFG[j.status] ?? STATUS_CFG.saved;
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[var(--color-bright)] font-medium truncate">{j.title}</p>
        <p className="text-[9px] text-[var(--color-dim)]">{j.company} · {j.location}</p>
      </div>
      <span className="text-[9px] font-mono text-[var(--color-muted)] w-24 text-right">{salary(j.salaryMin, j.salaryMax, j.currency)}</span>
      <span className="text-[9px] text-[var(--color-dim)] w-16 text-right">{j.source}</span>
      <span className="text-[9px] text-[var(--color-dim)] w-14 text-right">{timeAgo(j.updatedAt)}</span>
      <span className="badge text-[9px] w-20 text-center py-0.5 rounded" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}40` }}>{cfg.label}</span>
    </div>
  )
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (search) params.set('q', search);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/jobs${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setJobs(data.jobs ?? []); setTotal(data.total ?? 0); setCounts(data.counts ?? {});
  }, [statusFilter, search])

  useEffect(() => { fetchData() }, [fetchData])

  const FILTERS = [
    { key: 'all', label: 'tutti' }, { key: 'saved', label: 'salvati' }, { key: 'applied', label: 'candidati' },
    { key: 'interview', label: 'colloqui' }, { key: 'offer', label: 'offerte' }, { key: 'rejected', label: 'rifiutati' },
  ];

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Jobs</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Offerte Lavoro</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} offerte · {counts.interview ?? 0} colloqui · {counts.offer ?? 0} offerte</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca titolo, azienda, luogo..."
          aria-label="Cerca offerte" className="text-[10px] px-3 py-1.5 rounded w-56" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }} />
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className="px-2.5 py-1 rounded text-[9px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
              style={{ background: statusFilter === f.key ? 'var(--color-row)' : 'transparent', color: statusFilter === f.key ? (STATUS_CFG[f.key]?.color ?? 'var(--color-bright)') : 'var(--color-dim)', border: `1px solid ${statusFilter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {f.label}{counts[f.key] ? ` (${counts[f.key]})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">POSIZIONE</span>
          <span className="w-24 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">SALARY</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">SOURCE</span>
          <span className="w-14 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">DATA</span>
          <span className="w-20 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-center">STATO</span>
        </div>
        {jobs.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna offerta trovata.</p></div>
          : jobs.map(j => <JobRow key={j.id} j={j} />)}
      </div>
    </div>
  )
}
