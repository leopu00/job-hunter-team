'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type TimelineEvent = { id: string; type: string; title: string; description: string; company?: string; date: number }

const TYPE_CFG: Record<string, { label: string; color: string }> = {
  application: { label: 'Candidatura', color: '#61affe' },
  interview: { label: 'Colloquio', color: '#fca130' },
  offer: { label: 'Offerta', color: 'var(--color-green)' },
  'follow-up': { label: 'Follow-up', color: '#50e3c2' },
  contact: { label: 'Contatto', color: '#9b59b6' },
  update: { label: 'Aggiornamento', color: 'var(--color-dim)' },
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: undefined })
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function groupByDate(events: TimelineEvent[]): [string, TimelineEvent[]][] {
  const map = new Map<string, TimelineEvent[]>()
  for (const e of events) {
    const key = new Date(e.date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
    const arr = map.get(key) ?? []
    arr.push(e)
    map.set(key, arr)
  }
  return [...map.entries()]
}

export default function TimelinePage() {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [total, setTotal] = useState(0)
  const [types, setTypes] = useState<string[]>([])
  const [typeFilter, setTypeFilter] = useState('')
  const [days, setDays] = useState(30)
  const [compact, setCompact] = useState(false)

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams({ days: String(days) })
    if (typeFilter) params.set('type', typeFilter)
    const res = await fetch(`/api/timeline?${params}`).catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    setEvents(d.events ?? []); setTotal(d.total ?? 0); setTypes(d.types ?? [])
  }, [typeFilter, days])

  useEffect(() => { fetchData() }, [fetchData])

  const groups = groupByDate(events)

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Timeline</span>
        </nav>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Timeline</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} eventi negli ultimi {days} giorni</p>
          </div>
          <button onClick={() => setCompact(!compact)} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer"
            style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{compact ? 'Dettagliata' : 'Compatta'}</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setTypeFilter('')} className="px-3 py-1 rounded text-[9px] font-bold cursor-pointer"
          style={{ background: !typeFilter ? 'var(--color-green)' : 'var(--color-row)', color: !typeFilter ? '#000' : 'var(--color-dim)', border: '1px solid var(--color-border)' }}>Tutti</button>
        {types.map(t => {
          const cfg = TYPE_CFG[t] ?? TYPE_CFG.update
          return <button key={t} onClick={() => setTypeFilter(t)} className="px-3 py-1 rounded text-[9px] font-bold cursor-pointer"
            style={{ background: typeFilter === t ? cfg.color : 'var(--color-row)', color: typeFilter === t ? '#000' : 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{cfg.label}</button>
        })}
        <div className="ml-auto flex gap-1">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className="px-2 py-1 rounded text-[8px] font-bold cursor-pointer"
              style={{ background: days === d ? 'var(--color-white)' : 'var(--color-row)', color: days === d ? '#000' : 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{d}g</button>
          ))}
        </div>
      </div>

      <div className="pl-4">
        {groups.length === 0 ? <p className="text-[var(--color-dim)] text-[12px] text-center py-12">Nessun evento nel periodo selezionato.</p> :
          groups.map(([dateLabel, evts]) => (
            <div key={dateLabel} className="mb-6">
              <p className="text-[9px] font-bold text-[var(--color-dim)] tracking-widest uppercase mb-2">{dateLabel}</p>
              {evts.map(e => {
                const cfg = TYPE_CFG[e.type] ?? TYPE_CFG.update
                return (
                  <div key={e.id} className="flex gap-3 mb-2 relative">
                    <div className="flex flex-col items-center">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1" style={{ background: cfg.color }} />
                      <div className="w-px flex-1" style={{ background: 'var(--color-border)' }} />
                    </div>
                    <div className={`flex-1 ${compact ? 'pb-1' : 'pb-3'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: cfg.color, color: '#000' }}>{cfg.label}</span>
                        <span className="text-[11px] text-[var(--color-bright)] font-medium">{e.title}</span>
                        <span className="text-[8px] text-[var(--color-dim)] ml-auto">{fmtTime(e.date)}</span>
                      </div>
                      {!compact && e.description && <p className="text-[9px] text-[var(--color-dim)] mt-0.5">{e.description}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
      </div>
    </div>
  )
}
