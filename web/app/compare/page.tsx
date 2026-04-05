'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type JobOption = { id: string; title: string; company: string; score: number; status: string }
type Job = { id: string; title: string; company: string; location: string; remote: string; salaryMin: number; salaryMax: number; score: number; matchedSkills: string[]; missingSkills: string[]; benefits: string[]; status: string }
type Highlights = { bestScoreId?: string; bestSalaryId?: string }

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  saved: { label: 'Salvata', color: 'var(--color-dim)' }, applied: { label: 'Candidato', color: '#61affe' },
  interview: { label: 'Colloquio', color: 'var(--color-yellow)' }, offer: { label: 'Offerta', color: 'var(--color-green)' },
  rejected: { label: 'Rifiutata', color: 'var(--color-red)' },
}

function ScoreBar({ value, best }: { value: number; best: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full" style={{ background: 'var(--color-border)' }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: best ? 'var(--color-green)' : '#61affe' }} />
      </div>
      <span className="text-[11px] font-bold" style={{ color: best ? 'var(--color-green)' : 'var(--color-bright)' }}>{value}%</span>
    </div>
  )
}

export default function ComparePage() {
  const [available, setAvailable] = useState<JobOption[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [highlights, setHighlights] = useState<Highlights>({})

  const fetchAvailable = useCallback(async () => {
    const res = await fetch('/api/compare').catch(() => null)
    if (!res?.ok) return
    setAvailable((await res.json()).available ?? [])
  }, [])

  useEffect(() => { fetchAvailable() }, [fetchAvailable])

  const toggle = (id: string) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : p.length >= 4 ? p : [...p, id])

  const compare = async () => {
    if (selected.length < 2) return
    const res = await fetch(`/api/compare?ids=${selected.join(',')}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setJobs(data.jobs ?? []); setHighlights(data.highlights ?? {})
  }

  const reset = () => { setJobs([]); setSelected([]); setHighlights({}) }
  const fmtSalary = (min: number, max: number) => `${(min / 1000).toFixed(0)}k–${(max / 1000).toFixed(0)}k €`

  const ROWS: Array<{ label: string; render: (j: Job) => React.ReactNode }> = [
    { label: 'Posizione', render: j => <span className="text-[11px] font-semibold text-[var(--color-bright)]">{j.title}</span> },
    { label: 'Azienda', render: j => <span className="text-[11px] text-[var(--color-muted)]">{j.company}</span> },
    { label: 'Sede', render: j => <span className="text-[10px] text-[var(--color-muted)]">{j.location} · {j.remote === 'remote' ? 'Full remote' : j.remote === 'hybrid' ? 'Ibrido' : 'In sede'}</span> },
    { label: 'RAL', render: j => <span className="text-[11px] font-bold" style={{ color: highlights.bestSalaryId === j.id ? 'var(--color-green)' : 'var(--color-bright)' }}>{fmtSalary(j.salaryMin, j.salaryMax)}</span> },
    { label: 'Score', render: j => <ScoreBar value={j.score} best={highlights.bestScoreId === j.id} /> },
    { label: 'Stato', render: j => { const s = STATUS_LABEL[j.status]; return <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ color: s?.color, border: '1px solid var(--color-border)' }}>{s?.label ?? j.status}</span> }},
    { label: 'Skill OK', render: j => <div className="flex flex-wrap gap-1">{j.matchedSkills.map(s => <span key={s} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)' }}>{s}</span>)}</div> },
    { label: 'Skill mancanti', render: j => j.missingSkills.length > 0 ? <div className="flex flex-wrap gap-1">{j.missingSkills.map(s => <span key={s} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,69,96,0.1)', color: 'var(--color-red)' }}>{s}</span>)}</div> : <span className="text-[9px] text-[var(--color-green)]">Nessuna</span> },
    { label: 'Benefits', render: j => <div className="flex flex-wrap gap-1">{j.benefits.map(b => <span key={b} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-dim)' }}>{b}</span>)}</div> },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Confronto</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Confronto Candidature</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Seleziona 2-4 candidature per un confronto side-by-side</p>
      </div>

      {jobs.length === 0 && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {available.map(j => (
              <button key={j.id} onClick={() => toggle(j.id)} className="px-3 py-2 rounded-lg text-[10px] cursor-pointer transition-colors"
                style={{ background: selected.includes(j.id) ? 'var(--color-green)' : 'var(--color-row)', color: selected.includes(j.id) ? '#000' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                <span className="font-bold">{j.title}</span> · {j.company} <span className="text-[8px] opacity-70">({j.score}%)</span>
              </button>
            ))}
          </div>
          <button onClick={compare} disabled={selected.length < 2} className="px-4 py-2 rounded-lg text-[11px] font-bold cursor-pointer"
            style={{ background: selected.length >= 2 ? 'var(--color-green)' : 'var(--color-border)', color: selected.length >= 2 ? '#000' : 'var(--color-dim)', border: 'none' }}>
            Confronta ({selected.length} selezionate)
          </button>
        </>
      )}

      {jobs.length > 0 && (
        <>
          <button onClick={reset} className="mb-4 px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer"
            style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>← Nuovo confronto</button>
          <div className="border border-[var(--color-border)] rounded-lg overflow-x-auto bg-[var(--color-panel)]">
            {ROWS.map(r => (
              <div key={r.label} className="flex border-b border-[var(--color-border)]">
                <div className="w-28 flex-shrink-0 px-3 py-3 text-[8px] font-bold uppercase tracking-widest text-[var(--color-dim)]" style={{ background: 'var(--color-row)' }}>{r.label}</div>
                {jobs.map(j => (
                  <div key={j.id} className="flex-1 min-w-[160px] px-4 py-3 border-l border-[var(--color-border)]">{r.render(j)}</div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
