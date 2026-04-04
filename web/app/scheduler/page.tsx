'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Task = { id: string; name: string; priority: string; status: string; dependsOn: string[]; createdAt: number; startedAt?: number; completedAt?: number; error?: string }
type Stats = { pending: number; running: number; completed: number; failed: number; cancelled: number }

const STATUS_CLR: Record<string, string> = {
  pending: 'var(--color-yellow)', running: 'var(--color-blue)', completed: 'var(--color-green)',
  failed: 'var(--color-red)', cancelled: 'var(--color-dim)', timeout: 'var(--color-red)',
}
const PRIO_CLR: Record<string, string> = {
  critical: 'var(--color-red)', high: 'var(--color-yellow)', normal: 'var(--color-muted)', low: 'var(--color-dim)',
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center p-3 rounded-lg" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
      <span className="text-xl font-bold font-mono" style={{ color }}>{value}</span>
      <span className="text-[9px] text-[var(--color-dim)] mt-0.5">{label}</span>
    </div>
  )
}

export default function SchedulerPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [stats, setStats] = useState<Stats>({ pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 })
  const [filter, setFilter] = useState('all')

  const fetchData = useCallback(async () => {
    const params = filter !== 'all' ? `?status=${filter}` : ''
    const res = await fetch(`/api/scheduler${params}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setTasks(data.tasks ?? [])
    setStats(data.stats ?? stats)
  }, [filter])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const id = setInterval(fetchData, 3000); return () => clearInterval(id) }, [fetchData])

  const cancelTask = async (id: string) => {
    await fetch('/api/scheduler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', id }) }).catch(() => null)
    fetchData()
  }

  const FILTERS = ['all', 'pending', 'running', 'completed', 'failed', 'cancelled']

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Scheduler</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Scheduler</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Coda prioritaria con dipendenze · {tasks.length} task</p>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-6">
        <StatBox label="Pendenti" value={stats.pending} color="var(--color-yellow)" />
        <StatBox label="In esecuzione" value={stats.running} color="var(--color-blue)" />
        <StatBox label="Completati" value={stats.completed} color="var(--color-green)" />
        <StatBox label="Falliti" value={stats.failed} color="var(--color-red)" />
        <StatBox label="Cancellati" value={stats.cancelled} color="var(--color-dim)" />
      </div>

      <div className="flex gap-1 mb-4">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
            style={{ background: filter === f ? 'var(--color-row)' : 'transparent', color: filter === f ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {f}
          </button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {tasks.length === 0
          ? <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun task in coda.</p></div>
          : tasks.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
              <span className="font-mono text-[11px] font-semibold text-[var(--color-bright)]">{t.id}</span>
              <span className="text-[11px] text-[var(--color-muted)] flex-1">{t.name}</span>
              <span className="badge text-[9px]" style={{ color: PRIO_CLR[t.priority] || 'var(--color-dim)' }}>{t.priority}</span>
              <span className="badge text-[9px]" style={{ color: STATUS_CLR[t.status] || 'var(--color-dim)', background: `${STATUS_CLR[t.status]}15`, border: `1px solid ${STATUS_CLR[t.status]}40` }}>{t.status}</span>
              {t.dependsOn.length > 0 && <span className="text-[9px] text-[var(--color-dim)] font-mono">deps: {t.dependsOn.join(',')}</span>}
              {t.status === 'pending' && <button onClick={() => cancelTask(t.id)} className="text-[9px] text-[var(--color-red)] cursor-pointer font-semibold">cancel</button>}
            </div>
          ))
        }
      </div>
    </div>
  )
}
