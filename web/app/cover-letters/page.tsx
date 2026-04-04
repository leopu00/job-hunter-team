'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type CoverLetter = { id: string; title: string; jobTarget: string; company: string; template: string; status: string; content: string; createdAt: number; updatedAt: number; wordCount: number }

const STATUS_CFG: Record<string, { color: string; bg: string; label: string }> = {
  draft: { color: 'var(--color-yellow)', bg: 'rgba(255,193,7,0.08)', label: 'bozza' },
  final: { color: 'var(--color-green)',  bg: 'rgba(0,200,83,0.08)',  label: 'finale' },
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function CLRow({ cl, expanded, onToggle }: { cl: CoverLetter; expanded: boolean; onToggle: () => void }) {
  const cfg = STATUS_CFG[cl.status] ?? STATUS_CFG.draft;
  return (
    <div className="border-b border-[var(--color-border)]">
      <div className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-bright)] font-medium truncate">{cl.title}</p>
          <p className="text-[9px] text-[var(--color-dim)]">{cl.jobTarget} · {cl.company}</p>
        </div>
        <span className="text-[9px] font-mono text-[var(--color-dim)] px-2 py-0.5 rounded" style={{ border: '1px solid var(--color-border)' }}>{cl.template}</span>
        <span className="text-[9px] font-mono text-[var(--color-dim)] w-14 text-right">{cl.wordCount} parole</span>
        <span className="text-[9px] text-[var(--color-dim)] w-14 text-right">{timeAgo(cl.updatedAt)}</span>
        <span className="badge text-[9px] w-16 text-center py-0.5 rounded" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}40` }}>{cfg.label}</span>
      </div>
      {expanded && (
        <div className="px-5 pb-4 pl-8">
          <pre className="text-[10px] font-mono text-[var(--color-muted)] p-4 rounded whitespace-pre-wrap leading-relaxed" style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)' }}>{cl.content}</pre>
          <p className="text-[9px] text-[var(--color-dim)] mt-2">Creata: {timeAgo(cl.createdAt)} · Aggiornata: {timeAgo(cl.updatedAt)} · Template: {cl.template}</p>
        </div>
      )}
    </div>
  )
}

export default function CoverLettersPage() {
  const [letters, setLetters] = useState<CoverLetter[]>([])
  const [total, setTotal] = useState(0)
  const [drafts, setDrafts] = useState(0)
  const [finals, setFinals] = useState(0)
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/cover-letters${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setLetters(data.letters ?? []); setTotal(data.total ?? 0); setDrafts(data.drafts ?? 0); setFinals(data.finals ?? 0);
  }, [statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const FILTERS = [{ key: 'all', label: 'tutte' }, { key: 'draft', label: `bozze (${drafts})` }, { key: 'final', label: `finali (${finals})` }];

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Cover Letter</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Cover Letter</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} lettere · {finals} finali · {drafts} bozze</p>
      </div>

      <div className="flex gap-1 mb-4">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setStatusFilter(f.key)}
            className="px-3 py-1 rounded text-[9px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
            style={{ background: statusFilter === f.key ? 'var(--color-row)' : 'transparent', color: statusFilter === f.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${statusFilter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">COVER LETTER</span>
          <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">TEMPLATE</span>
          <span className="w-14 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">PAROLE</span>
          <span className="w-14 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">DATA</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-center">STATO</span>
        </div>
        {letters.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna cover letter trovata.</p></div>
          : letters.map(cl => <CLRow key={cl.id} cl={cl} expanded={expandedId === cl.id} onToggle={() => setExpandedId(expandedId === cl.id ? null : cl.id)} />)}
      </div>
    </div>
  )
}
