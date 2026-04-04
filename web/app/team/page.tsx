'use client'

import { useState, useEffect } from 'react'
import { FilterBar, FilterDef, FilterValues } from '../components/FilterBar'
import { EmptyState } from '../components/EmptyState'

type Member = {
  id: string; name: string; role: string; session: string
  online: boolean; last_task: { id: string; stato: string } | null
}

const TASK_COLORS: Record<string, string> = {
  completed: 'var(--color-green)', merged: 'var(--color-green)',
  'in-progress': 'var(--color-blue)', 'pr-ready': 'var(--color-yellow)',
  blocked: 'var(--color-red)',
}

function TaskBadge({ task }: { task: Member['last_task'] }) {
  if (!task) return <span style={{ color: 'var(--color-dim)', fontSize: 10 }}>—</span>
  const color = TASK_COLORS[task.stato] ?? 'var(--color-dim)'
  return (
    <span className="inline-flex gap-1.5 items-center px-2 py-0.5 rounded text-[9px] font-mono"
      style={{ border: `1px solid ${color}44`, background: `${color}11`, color }}>
      {task.id} · {task.stato}
    </span>
  )
}

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterValues>({ role: '', status: '' })

  useEffect(() => {
    const load = () => fetch('/api/team').then(r => r.json()).then(({ team }) => { setMembers(team ?? []); setLoading(false) })
      .catch(() => setLoading(false))
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [])

  const roles = [...new Set(members.map(m => m.role))]
  const defs: FilterDef[] = [
    { type: 'select', key: 'role', label: 'Ruolo', value: filters.role,
      options: roles.map(r => ({ value: r, label: r })) },
    { type: 'select', key: 'status', label: 'Stato', value: filters.status,
      options: [{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }] },
  ]

  const visible = members.filter(m => {
    if (filters.role   && m.role !== filters.role)        return false
    if (filters.status === 'online'  && !m.online)        return false
    if (filters.status === 'offline' &&  m.online)        return false
    return true
  })

  const online = members.filter(m => m.online).length

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-4xl flex flex-col gap-6">

        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--color-green)' }}>sistema</p>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>
              Team
              {!loading && <span className="ml-3 text-[11px] font-mono" style={{ color: 'var(--color-dim)' }}>
                {online}/{members.length} online
              </span>}
            </h1>
          </div>
          <FilterBar filters={defs} values={filters}
            onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))}
            onClear={() => setFilters({ role: '', status: '' })} />
        </div>

        {loading ? (
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento…</p>
        ) : visible.length === 0 ? (
          <EmptyState icon="👥" title="Nessun membro trovato" size="sm" />
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: 'var(--color-deep)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Nome', 'Ruolo', 'Sessione', 'Stato', 'Ultimo task'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: 'var(--color-dim)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((m, i) => (
                  <tr key={m.id} style={{
                    background: 'var(--color-panel)',
                    borderBottom: i < visible.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}>
                    <td className="px-4 py-3 text-[12px] font-bold" style={{ color: 'var(--color-white)' }}>{m.name}</td>
                    <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--color-muted)' }}>{m.role}</td>
                    <td className="px-4 py-3 text-[10px] font-mono" style={{ color: 'var(--color-dim)' }}>{m.session}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold"
                        style={{ color: m.online ? 'var(--color-green)' : 'var(--color-dim)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block',
                          animation: m.online ? 'pulse-dot 2.5s ease-in-out infinite' : 'none' }} />
                        {m.online ? 'online' : 'offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3"><TaskBadge task={m.last_task} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && <p className="text-[9px]" style={{ color: 'var(--color-dim)' }}>Aggiornamento automatico ogni 15s</p>}
      </div>
    </main>
  )
}
