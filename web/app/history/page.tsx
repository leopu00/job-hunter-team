'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useMemo } from 'react'

type ActionType = 'view' | 'apply' | 'save' | 'edit' | 'delete'
type EntityType = 'job' | 'contact' | 'company' | 'template' | 'document' | 'session'
type Activity = { id: string; action: ActionType; entity: EntityType; entityName: string; detail?: string; timestamp: number }

const ACTION_CFG: Record<ActionType, { label: string; icon: string; color: string }> = {
  view:   { label: 'Visto',      icon: '👁', color: 'var(--color-muted)' },
  apply:  { label: 'Candidato',  icon: '📨', color: 'var(--color-green)' },
  save:   { label: 'Salvato',    icon: '⭐', color: 'var(--color-yellow)' },
  edit:   { label: 'Modificato', icon: '✏', color: '#61affe' },
  delete: { label: 'Eliminato',  icon: '🗑', color: 'var(--color-red)' },
}

const ENTITY_LABEL: Record<EntityType, string> = {
  job: 'Offerta', contact: 'Contatto', company: 'Azienda', template: 'Template', document: 'Documento', session: 'Sessione',
}

function groupByDay(items: Activity[]): { label: string; date: string; items: Activity[] }[] {
  const groups = new Map<string, Activity[]>()
  for (const a of items) {
    const d = new Date(a.timestamp)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(a)
  }
  const today = new Date(); const yesterday = new Date(Date.now() - 86_400_000)
  const fmt = (ds: string) => {
    const [y, m, d] = ds.split('-').map(Number)
    if (y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate()) return 'Oggi'
    if (y === yesterday.getFullYear() && m === yesterday.getMonth() + 1 && d === yesterday.getDate()) return 'Ieri'
    const dt = new Date(y, m - 1, d)
    return dt.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
  }
  return [...groups.entries()].map(([date, items]) => ({ label: fmt(date), date, items }))
}

function ActivityRow({ a }: { a: Activity }) {
  const cfg = ACTION_CFG[a.action] ?? ACTION_CFG.view
  const time = new Date(a.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-row)] transition-colors">
      <span className="text-sm flex-shrink-0">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-[var(--color-bright)]">{a.entityName}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ color: cfg.color, border: `1px solid var(--color-border)` }}>{cfg.label}</span>
          <span className="text-[9px] text-[var(--color-dim)]">{ENTITY_LABEL[a.entity]}</span>
        </div>
        {a.detail && <p className="text-[10px] text-[var(--color-dim)] truncate">{a.detail}</p>}
      </div>
      <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0">{time}</span>
    </div>
  )
}

export default function HistoryPage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [filterAction, setFilterAction] = useState<string>('all')
  const [days, setDays] = useState(7)

  const fetchData = useCallback(async () => {
    const p = new URLSearchParams(); p.set('days', String(days))
    if (filterAction !== 'all') p.set('action', filterAction)
    const res = await fetch(`/api/history?${p}`).catch(() => null)
    if (!res?.ok) return
    setActivities((await res.json()).activities ?? [])
  }, [filterAction, days])

  useEffect(() => { fetchData() }, [fetchData])

  const clearHistory = async () => { await fetch('/api/history?all=true', { method: 'DELETE' }); fetchData() }

  const grouped = useMemo(() => groupByDay(activities), [activities])

  const ACTIONS: Array<{ key: string; label: string }> = [
    { key: 'all', label: 'tutte' }, { key: 'view', label: 'visti' }, { key: 'apply', label: 'candidature' },
    { key: 'save', label: 'salvati' }, { key: 'edit', label: 'modifiche' }, { key: 'delete', label: 'eliminati' },
  ]
  const PERIODS = [{ v: 7, l: '7g' }, { v: 30, l: '30g' }, { v: 90, l: '90g' }]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Cronologia</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Cronologia</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{activities.length} attività negli ultimi {days} giorni</p>
          </div>
          {activities.length > 0 && (
            <button onClick={clearHistory} className="px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
              style={{ border: '1px solid rgba(255,69,96,0.3)', color: 'var(--color-red)', background: 'transparent' }}>cancella cronologia</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div className="flex gap-1">
          {ACTIONS.map(a => (
            <button key={a.key} onClick={() => setFilterAction(a.key)}
              className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
              style={{ background: filterAction === a.key ? 'var(--color-row)' : 'transparent', color: filterAction === a.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filterAction === a.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button key={p.v} onClick={() => setDays(p.v)}
              className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
              style={{ background: days === p.v ? 'var(--color-row)' : 'transparent', color: days === p.v ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${days === p.v ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {p.l}
            </button>
          ))}
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] py-16 text-center">
          <p className="text-[var(--color-dim)] text-[12px]">Nessuna attività trovata.</p>
        </div>
      ) : grouped.map(g => (
        <div key={g.date} className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-1 px-1">{g.label}</p>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
            {g.items.map(a => <ActivityRow key={a.id} a={a} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
