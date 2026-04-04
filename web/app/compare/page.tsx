'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type JobOption = { id: string; title: string; company: string }
type ComparedJob = { id: string; title: string; company: string; location: string; salary: { min: number; max: number; currency: string }; benefits: string[]; skills: string[]; rating: number; remote: boolean; type: string; salaryScore: number; benefitCount: number; skillCount: number }

function Stars({ rating }: { rating: number }) {
  return <span className="text-[10px]">{'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))} <span className="text-[var(--color-dim)]">{rating.toFixed(1)}</span></span>
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max ? Math.round(value / max * 100) : 0
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-deep)' }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export default function ComparePage() {
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [comparison, setComparison] = useState<ComparedJob[]>([])
  const [loading, setLoading] = useState(false)

  const fetchJobs = useCallback(async () => {
    const res = await fetch('/api/compare').catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    setJobs(d.jobs ?? [])
  }, [])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const toggleSelect = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 3 ? prev : [...prev, id])
  }

  const compare = async () => {
    if (selected.length < 2) return
    setLoading(true)
    const res = await fetch('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selected }) }).catch(() => null)
    if (res?.ok) { const d = await res.json(); setComparison(d.comparison ?? []) }
    setLoading(false)
  }

  const maxSalary = Math.max(...comparison.map(j => j.salary.max), 1)
  const maxBenefits = Math.max(...comparison.map(j => j.benefitCount), 1)
  const maxSkills = Math.max(...comparison.map(j => j.skillCount), 1)

  const ROWS: [string, (j: ComparedJob) => React.ReactNode][] = [
    ['Azienda', j => <span className="text-[11px] text-[var(--color-bright)] font-medium">{j.company}</span>],
    ['Posizione', j => <span className="text-[10px] text-[var(--color-muted)]">{j.title}</span>],
    ['Località', j => <span className="text-[10px] text-[var(--color-muted)]">{j.location} {j.remote && <span style={{ color: 'var(--color-green)' }}>· Remote</span>}</span>],
    ['Tipo', j => <span className="text-[10px] text-[var(--color-dim)]">{j.type}</span>],
    ['RAL', j => <><span className="text-[11px] text-[var(--color-white)] font-bold">{(j.salary.min / 1000).toFixed(0)}k–{(j.salary.max / 1000).toFixed(0)}k €</span><Bar value={j.salary.max} max={maxSalary} color="var(--color-green)" /></>],
    ['Rating', j => <Stars rating={j.rating} />],
    ['Benefits', j => <><Bar value={j.benefitCount} max={maxBenefits} color="#61affe" /><div className="flex flex-wrap gap-1 mt-1">{j.benefits.map(b => <span key={b} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-deep)', color: 'var(--color-dim)' }}>{b}</span>)}</div></>],
    ['Skills', j => <><Bar value={j.skillCount} max={maxSkills} color="#49cc90" /><div className="flex flex-wrap gap-1 mt-1">{j.skills.map(s => <span key={s} className="text-[8px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--color-deep)', color: 'var(--color-muted)' }}>{s}</span>)}</div></>],
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Compara Offerte</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Compara Offerte</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Seleziona 2-3 offerte per un confronto side-by-side</p>
      </div>

      {comparison.length === 0 && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {jobs.map(j => (
              <button key={j.id} onClick={() => toggleSelect(j.id)} className="px-3 py-2 rounded-lg text-[10px] cursor-pointer transition-colors"
                style={{ background: selected.includes(j.id) ? 'var(--color-green)' : 'var(--color-row)', color: selected.includes(j.id) ? '#000' : 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                <span className="font-bold">{j.title}</span> · {j.company}
              </button>
            ))}
          </div>
          <button onClick={compare} disabled={selected.length < 2 || loading} className="px-4 py-2 rounded-lg text-[11px] font-bold cursor-pointer"
            style={{ background: selected.length >= 2 ? 'var(--color-green)' : 'var(--color-border)', color: selected.length >= 2 ? '#000' : 'var(--color-dim)' }}>
            {loading ? 'Caricamento...' : `Confronta (${selected.length}/3)`}
          </button>
        </>
      )}

      {comparison.length > 0 && (
        <>
          <button onClick={() => { setComparison([]); setSelected([]) }} className="mb-4 px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer"
            style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>← Nuovo confronto</button>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
            {ROWS.map(([label, render]) => (
              <div key={label} className="flex border-b border-[var(--color-border)]">
                <div className="w-24 flex-shrink-0 px-3 py-3 text-[8px] font-bold tracking-widest text-[var(--color-dim)]" style={{ background: 'var(--color-deep)' }}>{label.toUpperCase()}</div>
                {comparison.map(j => (
                  <div key={j.id} className="flex-1 px-4 py-3 border-l border-[var(--color-border)]">{render(j)}</div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
