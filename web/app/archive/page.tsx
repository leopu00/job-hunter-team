'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type ArchivedApp = { id: string; jobTitle: string; company: string; reason: string; appliedAt: number; closedAt: number; salary?: string; notes?: string }
type Counts = { rejected: number; expired: number; withdrawn: number }

const REASON_CFG: Record<string, { label: string; color: string }> = {
  rejected: { label: 'Rifiutata', color: 'var(--color-red)' },
  expired: { label: 'Scaduta', color: '#fca130' },
  withdrawn: { label: 'Ritirata', color: 'var(--color-dim)' },
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function ArchivePage() {
  const [items, setItems] = useState<ArchivedApp[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Counts>({ rejected: 0, expired: 0, withdrawn: 0 })
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    const params = filter ? `?reason=${filter}` : ''
    const res = await fetch(`/api/archive${params}`).catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    setItems(d.archive ?? []); setTotal(d.total ?? 0); setCounts(d.counts ?? {})
  }, [filter])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleSelect = (id: string) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const selectAll = () => {
    setSelected(prev => prev.size === items.length ? new Set() : new Set(items.map(i => i.id)))
  }

  const bulkDelete = async () => {
    if (!selected.size) return
    await fetch('/api/archive', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...selected] }) }).catch(() => null)
    setSelected(new Set()); fetchData()
  }

  const exportCsv = () => {
    const header = 'Posizione,Azienda,Motivo,Candidatura,Chiusura,RAL,Note'
    const rows = items.map(a => `"${a.jobTitle}","${a.company}","${a.reason}","${fmtDate(a.appliedAt)}","${fmtDate(a.closedAt)}","${a.salary ?? ''}","${a.notes ?? ''}"`)
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'archive.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Archivio</span>
        </nav>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Archivio</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} candidature chiuse — {counts.rejected} rifiutate · {counts.expired} scadute · {counts.withdrawn} ritirate</p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCsv} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>Export CSV</button>
            {selected.size > 0 && <button onClick={bulkDelete} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-red)', color: '#fff' }}>Elimina ({selected.size})</button>}
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {[['', 'Tutte'], ['rejected', 'Rifiutate'], ['expired', 'Scadute'], ['withdrawn', 'Ritirate']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className="px-3 py-1 rounded text-[9px] font-bold cursor-pointer"
            style={{ background: filter === k ? 'var(--color-green)' : 'var(--color-row)', color: filter === k ? '#000' : 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{l}</button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <input type="checkbox" aria-label="Seleziona tutti" checked={selected.size === items.length && items.length > 0} onChange={selectAll} className="cursor-pointer" />
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">POSIZIONE</span>
          <span className="w-20 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">MOTIVO</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">CANDIDATA</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">CHIUSA</span>
        </div>
        {items.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna candidatura archiviata.</p></div>
          : items.map(a => {
            const cfg = REASON_CFG[a.reason] ?? REASON_CFG.expired
            return (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
                <input type="checkbox" aria-label={`Seleziona ${a.jobTitle}`} checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} className="cursor-pointer" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[var(--color-bright)] font-medium truncate">{a.jobTitle}</p>
                  <p className="text-[9px] text-[var(--color-dim)]">{a.company}{a.salary ? ` · ${a.salary}` : ''}</p>
                  {a.notes && <p className="text-[8px] text-[var(--color-dim)] italic mt-0.5">{a.notes}</p>}
                </div>
                <span className="w-20 text-[8px] font-bold px-1.5 py-0.5 rounded-full text-center" style={{ background: cfg.color, color: '#000' }}>{cfg.label}</span>
                <span className="w-16 text-[9px] text-[var(--color-dim)] text-right">{fmtDate(a.appliedAt)}</span>
                <span className="w-16 text-[9px] text-[var(--color-dim)] text-right">{fmtDate(a.closedAt)}</span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
