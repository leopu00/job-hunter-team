'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type TimelineEntry = { status: string; date: number; note?: string }
type Doc = { name: string; type: string }
type Application = { id: string; jobTitle: string; company: string; status: string; sentAt: number; updatedAt: number; docs: Doc[]; timeline: TimelineEntry[] }

const STATUS_CFG: Record<string, { color: string; bg: string; label: string }> = {
  draft:     { color: 'var(--color-dim)',    bg: 'transparent',           label: 'bozza' },
  sent:      { color: '#61affe',             bg: 'rgba(97,175,254,0.08)', label: 'inviata' },
  viewed:    { color: 'var(--color-yellow)', bg: 'rgba(255,193,7,0.08)',  label: 'vista' },
  interview: { color: '#fca130',             bg: 'rgba(252,161,48,0.08)', label: 'colloquio' },
  offer:     { color: 'var(--color-green)',  bg: 'rgba(0,200,83,0.08)',   label: 'offerta' },
  rejected:  { color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.08)',  label: 'rifiutata' },
}
const DOC_CLR: Record<string, string> = { cv: 'var(--color-green)', 'cover-letter': '#61affe', portfolio: '#fca130', other: 'var(--color-dim)' }

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function AppRow({ a, expanded, onToggle }: { a: Application; expanded: boolean; onToggle: () => void }) {
  const cfg = STATUS_CFG[a.status] ?? STATUS_CFG.draft;
  return (
    <div className="border-b border-[var(--color-border)]">
      <div className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-bright)] font-medium truncate">{a.jobTitle}</p>
          <p className="text-[9px] text-[var(--color-dim)]">{a.company}</p>
        </div>
        <div className="flex gap-1">{a.docs.map((d, i) => <span key={i} className="text-[8px] px-1.5 py-0.5 rounded font-mono" style={{ color: DOC_CLR[d.type] ?? 'var(--color-dim)', border: `1px solid ${DOC_CLR[d.type] ?? 'var(--color-dim)'}30` }}>{d.type}</span>)}</div>
        <span className="text-[9px] text-[var(--color-dim)] w-14 text-right">{timeAgo(a.updatedAt)}</span>
        <span className="badge text-[9px] w-20 text-center py-0.5 rounded" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}40` }}>{cfg.label}</span>
      </div>
      {expanded && (
        <div className="px-5 pb-3 pl-8">
          <p className="text-[9px] text-[var(--color-dim)] mb-2 font-semibold">Timeline:</p>
          <div className="flex flex-col gap-1 ml-2 border-l border-[var(--color-border)] pl-3">
            {a.timeline.map((t, i) => {
              const tc = STATUS_CFG[t.status] ?? STATUS_CFG.draft;
              return (
                <div key={i} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ background: tc.color }} />
                  <span className="text-[9px] font-semibold w-16" style={{ color: tc.color }}>{tc.label}</span>
                  <span className="text-[9px] text-[var(--color-dim)]">{timeAgo(t.date)}</span>
                  {t.note && <span className="text-[9px] text-[var(--color-muted)]">— {t.note}</span>}
                </div>
              )
            })}
          </div>
          <div className="flex gap-2 mt-2">{a.docs.map((d, i) => <span key={i} className="text-[9px] font-mono text-[var(--color-muted)]">{d.name}</span>)}</div>
        </div>
      )}
    </div>
  )
}

export default function ApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/applications${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setApps(data.applications ?? []); setTotal(data.total ?? 0); setCounts(data.counts ?? {});
  }, [statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const FILTERS = [
    { key: 'all', label: 'tutte' }, { key: 'draft', label: 'bozze' }, { key: 'sent', label: 'inviate' },
    { key: 'viewed', label: 'viste' }, { key: 'interview', label: 'colloqui' }, { key: 'offer', label: 'offerte' }, { key: 'rejected', label: 'rifiutate' },
  ];

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Candidature</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Candidature</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} candidature · {counts.interview ?? 0} colloqui · {counts.offer ?? 0} offerte</p>
      </div>

      <div className="flex gap-1 mb-4">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setStatusFilter(f.key)}
            className="px-2.5 py-1 rounded text-[9px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
            style={{ background: statusFilter === f.key ? 'var(--color-row)' : 'transparent', color: statusFilter === f.key ? (STATUS_CFG[f.key]?.color ?? 'var(--color-bright)') : 'var(--color-dim)', border: `1px solid ${statusFilter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {f.label}{counts[f.key] ? ` (${counts[f.key]})` : ''}
          </button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {apps.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna candidatura trovata.</p></div>
          : apps.map(a => <AppRow key={a.id} a={a} expanded={expandedId === a.id} onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)} />)}
      </div>
    </div>
  )
}
