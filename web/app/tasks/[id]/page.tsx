'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

type TimelineEntry = { ts: number; label: string; status: string }
type TaskDetail = {
  taskId: string; runtime: string; ownerKey: string; agentId?: string; label?: string
  task: string; status: string; createdAt: number; startedAt?: number; endedAt?: number
  progressSummary?: string; error?: string; timeline: TimelineEntry[]; durationMs: number
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'var(--color-dim)', running: 'var(--color-blue)', succeeded: 'var(--color-green)',
  failed: 'var(--color-red)', timed_out: 'var(--color-yellow)', cancelled: 'var(--color-yellow)', lost: 'var(--color-red)',
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function TimelineNode({ entry, isLast }: { entry: TimelineEntry; isLast: boolean }) {
  const color = STATUS_COLORS[entry.status] ?? 'var(--color-dim)'
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="w-3 h-3 rounded-full shrink-0 border-2" style={{ borderColor: color, background: isLast ? color : 'transparent' }} />
        {!isLast && <div className="w-px flex-1 min-h-[24px]" style={{ background: 'var(--color-border)' }} />}
      </div>
      <div className="pb-4">
        <p className="text-[11px] font-semibold" style={{ color }}>{entry.label}</p>
        <p className="text-[9px] text-[var(--color-dim)]">{fmtTime(entry.ts)}</p>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-[var(--color-border)] last:border-0">
      <span className="text-[10px] text-[var(--color-dim)]">{label}</span>
      <span className="text-[10px] text-[var(--color-muted)] font-mono">{value}</span>
    </div>
  )
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/tasks/${id}`).catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    if (data && (data.status === 'queued' || data.status === 'running')) {
      const iv = setInterval(fetchData, 5000); return () => clearInterval(iv)
    }
  }, [fetchData, data?.status])

  const color = STATUS_COLORS[data?.status ?? ''] ?? 'var(--color-dim)'

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <Link href="/tasks" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Task</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)] truncate max-w-[140px]" aria-current="page">{data?.label ?? id?.slice(0, 8)}</span>
        </nav>
        <div className="mt-3 flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-white)]">{data?.label ?? data?.task?.slice(0, 60) ?? 'Task'}</h1>
          {data && <span className="text-[10px] px-2 py-0.5 rounded uppercase font-semibold" style={{ background: `${color}22`, color }}>{data.status}</span>}
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse">Caricamento...</p>
      ) : !data ? (
        <div className="text-center py-16">
          <p className="text-[var(--color-dim)] text-[12px]">Task non trovato.</p>
          <Link href="/tasks" className="text-[11px] text-[var(--color-green)] hover:underline mt-2 inline-block">← Torna ai task</Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)]">Timeline</p>
            </div>
            <div className="p-4">
              {data.timeline.length > 0 ? data.timeline.map((e, i) => (
                <TimelineNode key={i} entry={e} isLast={i === data.timeline.length - 1} />
              )) : <p className="text-[var(--color-dim)] text-[11px]">Nessun evento.</p>}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Dettagli</p>
              <InfoRow label="ID" value={data.taskId.slice(0, 12)} />
              <InfoRow label="Runtime" value={data.runtime} />
              <InfoRow label="Owner" value={data.ownerKey} />
              {data.agentId && <InfoRow label="Agente" value={data.agentId} />}
              <InfoRow label="Creato" value={fmtDate(data.createdAt)} />
              {data.startedAt && <InfoRow label="Avviato" value={fmtDate(data.startedAt)} />}
              {data.endedAt && <InfoRow label="Terminato" value={fmtDate(data.endedAt)} />}
              <InfoRow label="Durata" value={fmtDuration(data.durationMs)} />
            </div>

            {data.task && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">Descrizione</p>
                <pre className="text-[11px] text-[var(--color-muted)] font-mono whitespace-pre-wrap">{data.task}</pre>
              </div>
            )}

            {data.error && (
              <div className="p-3 rounded-lg border border-[rgba(255,69,96,0.3)] bg-[rgba(255,69,96,0.05)]">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-red)] mb-1">Errore</p>
                <pre className="text-[10px] text-[var(--color-red)] font-mono whitespace-pre-wrap">{data.error}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
