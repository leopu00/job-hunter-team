'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

type LogEntry = { ts: string; level: string; msg: string }
type TaskEntry = { id: string; name: string; status: string; createdAt: number; payload?: unknown }
type AgentDetail = {
  id: string; name: string; session: string | null; status: string
  config: Record<string, unknown>; logs: LogEntry[]; tasks: TaskEntry[]
  taskCount: number; logCount: number; hasDir: boolean
}

const STATUS_COLORS: Record<string, string> = {
  running: 'var(--color-green)', stopped: 'var(--color-dim)', unknown: 'var(--color-yellow)',
}
const LEVEL_COLORS: Record<string, string> = {
  error: 'var(--color-red)', warn: 'var(--color-yellow)', info: 'var(--color-muted)', debug: 'var(--color-dim)',
}
const TASK_COLORS: Record<string, string> = {
  succeeded: 'var(--color-green)', failed: 'var(--color-red)', running: 'var(--color-blue)',
  queued: 'var(--color-dim)', cancelled: 'var(--color-yellow)',
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'var(--color-dim)'
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full inline-block" style={{ background: color, boxShadow: status === 'running' ? `0 0 6px ${color}` : 'none' }} />
      <span className="text-[11px] capitalize" style={{ color }}>{status}</span>
    </span>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  const color = LEVEL_COLORS[entry.level] ?? 'var(--color-muted)'
  return (
    <div className="flex gap-2 text-[10px] font-mono leading-relaxed px-3 py-0.5 hover:bg-[var(--color-row)]">
      {entry.ts && <span className="text-[var(--color-dim)] shrink-0 w-20 truncate">{entry.ts.slice(11, 19) || entry.ts.slice(0, 19)}</span>}
      <span className="w-10 shrink-0 uppercase" style={{ color }}>{entry.level}</span>
      <span className="text-[var(--color-muted)] break-all">{entry.msg}</span>
    </div>
  )
}

function TaskRow({ t }: { t: TaskEntry }) {
  const color = TASK_COLORS[t.status] ?? 'var(--color-dim)'
  const date = t.createdAt ? new Date(t.createdAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] text-[11px] hover:bg-[var(--color-row)]">
      <span className="font-semibold text-[var(--color-bright)] w-28 truncate">{t.name}</span>
      <span className="px-1.5 py-0.5 rounded text-[9px] uppercase" style={{ background: `${color}22`, color }}>{t.status}</span>
      <span className="text-[var(--color-dim)] ml-auto">{date}</span>
    </div>
  )
}

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'logs' | 'tasks' | 'config'>('logs')

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/agents/${id}`).catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const iv = setInterval(fetchData, 10000); return () => clearInterval(iv) }, [fetchData])

  const TABS = [
    { v: 'logs' as const, l: 'Log', count: data?.logCount },
    { v: 'tasks' as const, l: 'Task', count: data?.taskCount },
    { v: 'config' as const, l: 'Config', count: null },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <Link href="/agents" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Agenti</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">{data?.name ?? id}</span>
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">{data?.name ?? id}</h1>
              {data && <StatusDot status={data.status} />}
            </div>
            <p className="text-[var(--color-dim)] text-[10px] mt-1">
              {data?.session ? `Sessione: ${data.session}` : 'Nessuna sessione tmux'}
              {data?.hasDir ? '' : ' · Nessuna directory agente'}
            </p>
          </div>
          <div className="flex gap-1">
            {TABS.map(t => (
              <button key={t.v} onClick={() => setTab(t.v)}
                className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
                style={{ background: tab === t.v ? 'var(--color-row)' : 'transparent', color: tab === t.v ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${tab === t.v ? 'var(--color-border-glow)' : 'transparent'}` }}>
                {t.l}{t.count != null ? ` (${t.count})` : ''}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Caricamento...</p>
      ) : !data ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Agente non trovato.</p>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
          {tab === 'logs' && (
            data.logs.length > 0 ? (
              <div className="max-h-[60vh] overflow-y-auto py-1">
                {data.logs.map((l, i) => <LogLine key={i} entry={l} />)}
              </div>
            ) : <p className="text-[var(--color-dim)] text-[11px] text-center py-12">Nessun log disponibile.</p>
          )}
          {tab === 'tasks' && (
            data.tasks.length > 0 ? (
              data.tasks.map(t => <TaskRow key={t.id} t={t} />)
            ) : <p className="text-[var(--color-dim)] text-[11px] text-center py-12">Nessun task per questo agente.</p>
          )}
          {tab === 'config' && (
            Object.keys(data.config).length > 0 ? (
              <pre className="p-4 text-[11px] text-[var(--color-muted)] font-mono whitespace-pre-wrap">{JSON.stringify(data.config, null, 2)}</pre>
            ) : <p className="text-[var(--color-dim)] text-[11px] text-center py-12">Nessuna configurazione specifica.</p>
          )}
        </div>
      )}
    </div>
  )
}
