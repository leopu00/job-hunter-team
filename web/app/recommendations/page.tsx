'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type JobRec = { id: string; title: string; company: string; location: string; score: number; reason: string; salary: string; remote: boolean }
type CompanyRec = { name: string; sector: string; score: number; reason: string; openPositions: number; rating: number }
type ActionRec = { id: string; action: string; target: string; priority: 'high' | 'medium' | 'low'; reason: string; deadline?: string }

const PRIO_CFG: Record<string, { label: string; color: string }> = {
  high: { label: 'Alta', color: 'var(--color-red)' },
  medium: { label: 'Media', color: '#fca130' },
  low: { label: 'Bassa', color: 'var(--color-dim)' },
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 85 ? 'var(--color-green)' : score >= 70 ? '#fca130' : 'var(--color-dim)'
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: color, color: '#000' }}>{score}%</span>
}

function Stars({ n }: { n: number }) {
  return <span className="text-[9px]">{'★'.repeat(Math.round(n))}{'☆'.repeat(5 - Math.round(n))}</span>
}

export default function RecommendationsPage() {
  const [jobs, setJobs] = useState<JobRec[]>([])
  const [companies, setCompanies] = useState<CompanyRec[]>([])
  const [actions, setActions] = useState<ActionRec[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/recommendations').catch(() => null)
    if (!res?.ok) { setLoading(false); return }
    const d = await res.json()
    setJobs(d.jobs ?? []); setCompanies(d.companies ?? []); setActions(d.actions ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Raccomandazioni</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Raccomandazioni AI</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Suggerimenti personalizzati basati sul tuo profilo e storico</p>
      </div>

      {loading ? (
        <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Caricamento...</p></div>
      ) : (<>
      <div className="mb-6">
        <h2 className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] mb-3">AZIONI PRIORITARIE</h2>
        <div className="flex flex-col gap-2">
          {actions.map(a => {
            const p = PRIO_CFG[a.priority] ?? PRIO_CFG.low
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="text-[11px] font-bold text-[var(--color-bright)]">{a.action}</span><span className="text-[9px] text-[var(--color-muted)]">{a.target}</span></div>
                  <p className="text-[9px] text-[var(--color-dim)]">{a.reason}</p>
                </div>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ color: p.color, border: `1px solid ${p.color}` }}>{p.label}</span>
                {a.deadline && <span className="text-[8px] text-[var(--color-dim)]">{a.deadline.slice(5)}</span>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h2 className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] mb-3">JOB SUGGERITI</h2>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
            {jobs.map(j => (
              <div key={j.id} className="px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-[var(--color-bright)]">{j.title}</span>
                  <ScoreBadge score={j.score} />
                </div>
                <p className="text-[9px] text-[var(--color-muted)]">{j.company} · {j.location} {j.remote && <span style={{ color: 'var(--color-green)' }}>· Remote</span>} · {j.salary}</p>
                <p className="text-[9px] text-[var(--color-dim)] mt-1 italic">{j.reason}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] mb-3">AZIENDE CONSIGLIATE</h2>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
            {companies.map(c => (
              <div key={c.name} className="px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-[var(--color-bright)]">{c.name}</span>
                  <ScoreBadge score={c.score} />
                </div>
                <p className="text-[9px] text-[var(--color-muted)]">{c.sector} · <Stars n={c.rating} /> · {c.openPositions} posizioni aperte</p>
                <p className="text-[9px] text-[var(--color-dim)] mt-1 italic">{c.reason}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>)}
    </div>
  )
}
