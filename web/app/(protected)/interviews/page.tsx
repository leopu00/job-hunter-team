'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Interview = { id: string; jobTitle: string; company: string; type: string; date: number; durationMin: number; outcome: string; notes: string; round: number }

const TYPE_CLR: Record<string, { color: string; label: string }> = {
  phone: { color: '#61affe', label: 'telefono' }, video: { color: 'var(--color-green)', label: 'video' },
  onsite: { color: '#fca130', label: 'in sede' }, 'take-home': { color: '#50e3c2', label: 'take-home' },
}
const OUT_CLR: Record<string, { color: string; label: string }> = {
  pending: { color: 'var(--color-yellow)', label: 'in attesa' }, passed: { color: 'var(--color-green)', label: 'superato' }, failed: { color: 'var(--color-red)', label: 'non superato' },
}

function fmtDate(ts: number): string { const d = new Date(ts); return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }); }
function fmtTime(ts: number): string { return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
function isUpcoming(ts: number): boolean { return ts > Date.now(); }

function IntRow({ int, expanded, onToggle }: { int: Interview; expanded: boolean; onToggle: () => void }) {
  const tc = TYPE_CLR[int.type] ?? { color: 'var(--color-dim)', label: int.type };
  const oc = OUT_CLR[int.outcome] ?? OUT_CLR.pending;
  const upcoming = isUpcoming(int.date);
  return (
    <div className="border-b border-[var(--color-border)]">
      <div role="button" tabIndex={0} aria-expanded={expanded} aria-label={`${expanded ? 'Chiudi' : 'Espandi'} colloquio: ${int.jobTitle} — ${int.company}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <div className="w-14 text-center flex-shrink-0">
          <p className="text-[10px] font-bold" style={{ color: upcoming ? 'var(--color-green)' : 'var(--color-dim)' }}>{fmtDate(int.date)}</p>
          <p className="text-[9px] font-mono text-[var(--color-dim)]">{fmtTime(int.date)}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-bright)] font-medium truncate">{int.jobTitle}</p>
          <p className="text-[9px] text-[var(--color-dim)]">{int.company} · Round {int.round}</p>
        </div>
        <span className="badge text-[8px] px-2 py-0.5 rounded" style={{ color: tc.color, border: `1px solid ${tc.color}40` }}>{tc.label}</span>
        <span className="text-[9px] font-mono text-[var(--color-dim)] w-10 text-right">{int.durationMin}m</span>
        <span className="badge text-[9px] w-20 text-center py-0.5 rounded" style={{ color: oc.color, background: `${oc.color}10`, border: `1px solid ${oc.color}40` }}>{oc.label}</span>
      </div>
      {expanded && (
        <div className="px-5 pb-3 pl-20">
          <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">{int.notes}</p>
        </div>
      )}
    </div>
  )
}

function CalendarStrip({ interviews }: { interviews: Interview[] }) {
  const upcoming = interviews.filter(i => isUpcoming(i.date)).sort((a, b) => a.date - b.date).slice(0, 7);
  if (upcoming.length === 0) return null;
  return (
    <div className="mb-6">
      <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">Prossimi colloqui</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {upcoming.map(i => {
          const tc = TYPE_CLR[i.type] ?? { color: 'var(--color-dim)', label: i.type };
          return (
            <div key={i.id} className="flex-shrink-0 p-3 rounded-lg w-36" style={{ background: 'var(--color-row)', border: `1px solid ${tc.color}30` }}>
              <p className="text-[10px] font-bold" style={{ color: tc.color }}>{fmtDate(i.date)} {fmtTime(i.date)}</p>
              <p className="text-[10px] text-[var(--color-bright)] mt-1 truncate">{i.company}</p>
              <p className="text-[9px] text-[var(--color-dim)] truncate">{i.jobTitle}</p>
              <p className="text-[8px] mt-1" style={{ color: tc.color }}>{tc.label} · {i.durationMin}m · R{i.round}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [total, setTotal] = useState(0)
  const [upcoming, setUpcoming] = useState(0)
  const [passed, setPassed] = useState(0)
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (outcomeFilter !== 'all') params.set('outcome', outcomeFilter);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/interviews${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setInterviews(data.interviews ?? []); setTotal(data.total ?? 0); setUpcoming(data.upcoming ?? 0); setPassed(data.passed ?? 0);
  }, [outcomeFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const FILTERS = [{ key: 'all', label: 'tutti' }, { key: 'pending', label: 'in attesa' }, { key: 'passed', label: 'superati' }, { key: 'failed', label: 'non superati' }];

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Colloqui</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Colloqui</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} colloqui · {upcoming} in programma · {passed} superati</p>
      </div>

      <CalendarStrip interviews={interviews} />

      <div className="flex gap-1 mb-4">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setOutcomeFilter(f.key)}
            className="px-2.5 py-1 rounded text-[9px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
            style={{ background: outcomeFilter === f.key ? 'var(--color-row)' : 'transparent', color: outcomeFilter === f.key ? (OUT_CLR[f.key]?.color ?? 'var(--color-bright)') : 'var(--color-dim)', border: `1px solid ${outcomeFilter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {interviews.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun colloquio trovato.</p></div>
          : interviews.map(i => <IntRow key={i.id} int={i} expanded={expandedId === i.id} onToggle={() => setExpandedId(expandedId === i.id ? null : i.id)} />)}
      </div>
    </div>
  )
}
