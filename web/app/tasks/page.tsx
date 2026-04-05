'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { EmptyState } from './components/EmptyState'

type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'lost'
type TaskRecord = { taskId: string; label?: string; task: string; agentId?: string; status: TaskStatus; createdAt: number; endedAt?: number }

const STATUS_CFG: Record<TaskStatus, { label: string; color: string; bg: string; border: string }> = {
  queued:    { label: 'in coda',    color: 'var(--color-muted)',  bg: 'transparent',            border: 'var(--color-border)' },
  running:   { label: 'in esecuzione', color: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.08)', border: 'rgba(245,197,24,0.3)' },
  succeeded: { label: 'completato', color: 'var(--color-green)',  bg: 'rgba(0,232,122,0.08)',   border: 'rgba(0,232,122,0.3)' },
  failed:    { label: 'fallito',    color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.08)',   border: 'rgba(255,69,96,0.3)' },
  timed_out: { label: 'timeout',    color: 'var(--color-orange)', bg: 'rgba(255,140,66,0.08)',  border: 'rgba(255,140,66,0.3)' },
  cancelled: { label: 'annullato',  color: 'var(--color-dim)',    bg: 'transparent',            border: 'var(--color-border)' },
  lost:      { label: 'perso',      color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.05)',   border: 'rgba(255,69,96,0.2)' },
}

const ACTIVE_STATUSES = new Set<TaskStatus>(['queued', 'running'])

function StatusBadge({ status }: { status: TaskStatus }) {
  const c = STATUS_CFG[status]
  return (
    <span className="badge" style={{ color: c.color, background: c.bg, border: `1px solid ${c.border}` }}>
      {status === 'running' && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--color-yellow)', marginRight: 5, verticalAlign: 'middle', animation: 'pulse-dot 1.4s ease-in-out infinite' }} />}
      {c.label}
    </span>
  )
}

function TaskRow({ task, onCancel }: { task: TaskRecord; onCancel: (id: string) => void }) {
  const isActive = ACTIVE_STATUSES.has(task.status)
  const age = Math.floor((Date.now() - task.createdAt) / 60000)
  const ageLabel = age < 1 ? 'adesso' : age < 60 ? `${age}m fa` : `${Math.floor(age / 60)}h fa`
  return (
    <div className="flex items-start gap-4 px-5 py-3.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          {task.label && <span className="text-[12px] font-semibold text-[var(--color-bright)]">{task.label}</span>}
          <StatusBadge status={task.status} />
          {task.agentId && <span className="text-[9px] font-mono text-[var(--color-dim)]">{task.agentId}</span>}
        </div>
        <p className="text-[11px] text-[var(--color-muted)] truncate">{task.task}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-[10px] text-[var(--color-dim)]">{ageLabel}</span>
        {isActive && (
          <button onClick={() => onCancel(task.taskId)}
            className="text-[10px] font-semibold tracking-wide transition-colors cursor-pointer"
            style={{ color: 'var(--color-dim)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--color-red)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>
            annulla
          </button>
        )}
      </div>
    </div>
  )
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [filter, setFilter] = useState<'all' | 'active' | 'terminal'>('all')
  const [showForm, setShowForm] = useState(false)
  const [newTask, setNewTask] = useState('')
  const [newAgent, setNewAgent] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchTasks = useCallback(async () => {
    const q = filter === 'all' ? '' : `?status=${filter}`
    const res = await fetch(`/api/tasks${q}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setTasks(data.tasks ?? [])
  }, [filter])

  useEffect(() => { fetchTasks() }, [fetchTasks])
  useEffect(() => {
    const id = setInterval(fetchTasks, 5000)
    return () => clearInterval(id)
  }, [fetchTasks])

  const cancelTask = async (id: string) => {
    await fetch(`/api/tasks?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    }).catch(() => null)
    fetchTasks()
  }

  const createTask = async () => {
    if (!newTask.trim()) return
    setCreating(true)
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: newTask, agentId: newAgent || undefined }),
    }).catch(() => null)
    setNewTask(''); setNewAgent(''); setShowForm(false); setCreating(false)
    fetchTasks()
  }

  const active = tasks.filter(t => ACTIVE_STATUSES.has(t.status)).length
  const FILTERS: Array<{ key: typeof filter; label: string }> = [
    { key: 'all', label: 'tutti' }, { key: 'active', label: 'attivi' }, { key: 'terminal', label: 'terminati' },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Task</span>
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Task</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{active} attivi · {tasks.length} totali</p>
          </div>
          <button onClick={() => setShowForm(v => !v)}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all"
            style={{ background: showForm ? 'var(--color-border)' : 'var(--color-green)', color: showForm ? 'var(--color-muted)' : '#000', cursor: 'pointer' }}>
            {showForm ? '✕ annulla' : '+ nuovo task'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]" style={{ animation: 'fade-in 0.2s ease both' }}>
          <div className="flex flex-col gap-3">
            <input value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === 'Enter' && createTask()}
              placeholder="Descrizione task…" aria-label="Descrizione task" className="text-[12px]" style={{ color: 'var(--color-bright)' }} />
            <div className="flex gap-2">
              <input value={newAgent} onChange={e => setNewAgent(e.target.value)} placeholder="Agente (opzionale, es. SCOUT-1)"
                aria-label="Agente" className="flex-1 text-[12px]" style={{ color: 'var(--color-bright)' }} />
              <button onClick={createTask} disabled={!newTask.trim() || creating}
                className="px-5 py-2 rounded-lg text-[11px] font-bold tracking-wide flex-shrink-0"
                style={{ background: newTask.trim() ? 'var(--color-green)' : 'var(--color-border)', color: newTask.trim() ? '#000' : 'var(--color-dim)', cursor: newTask.trim() ? 'pointer' : 'default' }}>
                {creating ? '…' : 'crea'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-1 mb-4">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
            style={{ background: filter === f.key ? 'var(--color-row)' : 'transparent', color: filter === f.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {tasks.length === 0
          ? <EmptyState icon="📋" title="Nessun task" description="I task degli agenti appariranno qui." size="md" />
          : tasks.map(t => <TaskRow key={t.taskId} task={t} onCancel={cancelTask} />)
        }
      </div>
    </div>
  )
}
