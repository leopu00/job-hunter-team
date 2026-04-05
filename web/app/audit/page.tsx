'use client'

import { useState, useEffect } from 'react'
import { FilterBar, FilterDef, FilterValues } from '../components/FilterBar'
import { EmptyState } from '../components/EmptyState'
import { Pagination } from '../components/Pagination'

type Severity = 'info' | 'warning' | 'critical'
type AuditEvent = { id: string; ts: string; severity: Severity; actor: string; action: string; detail: string }

const SEV: Record<Severity, { color: string; bg: string; label: string }> = {
  info:     { color: 'var(--color-blue)',   bg: 'rgba(77,159,255,0.1)',  label: 'info' },
  warning:  { color: 'var(--color-yellow)', bg: 'rgba(255,196,0,0.1)',   label: 'warning' },
  critical: { color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.1)',   label: 'critical' },
}

function SevBadge({ s }: { s: Severity }) {
  const { color, bg, label } = SEV[s]
  return (
    <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
      style={{ border: `1px solid ${color}44`, background: bg, color }}>
      {label}
    </span>
  )
}

const PER_PAGE = 25

export default function AuditPage() {
  const [events,  setEvents]  = useState<AuditEvent[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterValues>({ severity: '', date: '' })
  const [page,    setPage]    = useState(1)

  useEffect(() => {
    setPage(1)
    setLoading(true)
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString()
    fetch(`/api/audit${qs ? '?' + qs : ''}`).then(r => r.json()).then(d => {
      setEvents(d.events ?? [])
      setTotal(d.total ?? 0)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [filters])

  const defs: FilterDef[] = [
    { type: 'select', key: 'severity', label: 'Severity', value: filters.severity,
      options: [{ value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'critical', label: 'Critical' }] },
    { type: 'date', key: 'date', label: 'Data', value: filters.date },
  ]

  const totalPages = Math.ceil(events.length / PER_PAGE)
  const visible    = events.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const counts = { info: 0, warning: 0, critical: 0 }
  for (const e of events) counts[e.severity]++

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-5xl flex flex-col gap-6">

        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--color-green)' }}>sistema</p>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>
              Audit Log
              {!loading && <span className="ml-3 text-[11px] font-mono" style={{ color: 'var(--color-dim)' }}>{total} eventi</span>}
            </h1>
          </div>
          <FilterBar filters={defs} values={filters}
            onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))}
            onClear={() => setFilters({ severity: '', date: '' })} />
        </div>

        {/* Summary badges */}
        {!loading && (
          <div className="flex gap-3 flex-wrap">
            {(Object.entries(counts) as [Severity, number][]).map(([s, n]) => (
              <div key={s} className="flex items-center gap-2 px-3 py-1.5 rounded"
                style={{ border: `1px solid ${SEV[s].color}33`, background: SEV[s].bg }}>
                <span className="text-[9px] font-bold uppercase" style={{ color: SEV[s].color }}>{s}</span>
                <span className="text-[12px] font-mono font-bold" style={{ color: SEV[s].color }}>{n}</span>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }} role="status" aria-live="polite">Caricamento…</p>
        ) : visible.length === 0 ? (
          <EmptyState icon="📋" title="Nessun evento trovato" size="sm" />
        ) : (
          <>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <table className="w-full border-collapse" aria-label="Log di audit">
                <thead>
                  <tr style={{ background: 'var(--color-deep)', borderBottom: '1px solid var(--color-border)' }}>
                    {['Severity', 'Timestamp', 'Attore', 'Azione', 'Dettaglio'].map(h => (
                      <th key={h} scope="col" className="px-4 py-2.5 text-left text-[9px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--color-dim)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e, i) => (
                    <tr key={e.id} style={{ background: 'var(--color-panel)', borderBottom: i < visible.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                      <td className="px-4 py-2.5"><SevBadge s={e.severity} /></td>
                      <td className="px-4 py-2.5 text-[10px] font-mono whitespace-nowrap" style={{ color: 'var(--color-dim)' }}>{e.ts}</td>
                      <td className="px-4 py-2.5 text-[11px] font-semibold" style={{ color: 'var(--color-muted)' }}>{e.actor}</td>
                      <td className="px-4 py-2.5 text-[11px] font-semibold" style={{ color: 'var(--color-bright)' }}>{e.action}</td>
                      <td className="px-4 py-2.5 text-[10px]" style={{ color: 'var(--color-dim)', maxWidth: 320 }}>
                        <span className="line-clamp-1">{e.detail}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} perPage={PER_PAGE}
                totalItems={events.length} onPage={setPage} />
            )}
          </>
        )}
      </div>
    </main>
  )
}
