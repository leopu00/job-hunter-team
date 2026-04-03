'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead'
type JobPriority = 'low' | 'normal' | 'high' | 'critical'
type JobRecord = { id: string; name: string; priority: JobPriority; status: JobStatus; attempts: number; maxAttempts: number; createdAt: number; startedAt?: number; endedAt?: number; lastError?: string }
type QueueStats = { queued: number; running: number; succeeded: number; failed: number; dead: number; totalProcessed: number }

const STATUS_CFG: Record<JobStatus, { label: string; color: string; bg: string }> = {
  queued:    { label: 'in coda',     color: 'var(--color-muted)',  bg: 'transparent' },
  running:   { label: 'in esecuzione', color: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.08)' },
  succeeded: { label: 'completato',  color: 'var(--color-green)',  bg: 'rgba(0,232,122,0.08)' },
  failed:    { label: 'fallito',     color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.08)' },
  dead:      { label: 'dead-letter', color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.12)' },
}

const PRIORITY_COLORS: Record<JobPriority, string> = {
  critical: 'var(--color-red)', high: 'var(--color-orange)', normal: 'var(--color-muted)', low: 'var(--color-dim)',
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 min-w-[100px] p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="text-[20px] font-bold" style={{ color }}>{value}</div>
      <div className="text-[10px] text-[var(--color-dim)] uppercase tracking-widest mt-0.5">{label}</div>
    </div>
  )
}

function JobRow({ job, onRetry }: { job: JobRecord; onRetry?: (id: string) => void }) {
  const cfg = STATUS_CFG[job.status]
  const age = Math.floor((Date.now() - job.createdAt) / 60000)
  const ageLabel = age < 1 ? 'adesso' : age < 60 ? `${age}m fa` : `${Math.floor(age / 60)}h fa`
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors text-[11px]">
      <span className="font-mono text-[var(--color-bright)] w-[140px] truncate">{job.name}</span>
      <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span>
      <span className="text-[10px] font-semibold" style={{ color: PRIORITY_COLORS[job.priority] }}>{job.priority}</span>
      <span className="text-[var(--color-dim)]">{job.attempts}/{job.maxAttempts}</span>
      <span className="flex-1" />
      {job.lastError && <span className="text-[var(--color-red)] truncate max-w-[200px]" title={job.lastError}>{job.lastError}</span>}
      <span className="text-[var(--color-dim)]">{ageLabel}</span>
      {job.status === 'dead' && onRetry && (
        <button onClick={() => onRetry(job.id)} className="text-[10px] font-semibold text-[var(--color-yellow)] hover:text-[var(--color-bright)] cursor-pointer transition-colors">retry</button>
      )}
    </div>
  )
}

type Tab = 'overview' | 'pending' | 'running' | 'completed' | 'dead'

export default function QueuePage() {
  const [stats, setStats] = useState<QueueStats>({ queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0, totalProcessed: 0 })
  const [pending, setPending] = useState<JobRecord[]>([])
  const [running, setRunning] = useState<JobRecord[]>([])
  const [completed, setCompleted] = useState<JobRecord[]>([])
  const [deadLetter, setDeadLetter] = useState<JobRecord[]>([])
  const [tab, setTab] = useState<Tab>('overview')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/queue').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setStats(data.stats ?? stats)
    setPending(data.pending ?? [])
    setRunning(data.running ?? [])
    setCompleted(data.completed ?? [])
    setDeadLetter(data.deadLetter ?? [])
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const id = setInterval(fetchData, 5000); return () => clearInterval(id) }, [fetchData])

  const retryJob = async (jobId: string) => {
    await fetch('/api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry', jobId }) }).catch(() => null)
    fetchData()
  }
  const clearDlq = async () => {
    await fetch('/api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear-dlq' }) }).catch(() => null)
    fetchData()
  }

  const TABS: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'overview', label: 'panoramica' },
    { key: 'pending', label: 'in coda', count: stats.queued },
    { key: 'running', label: 'in esecuzione', count: stats.running },
    { key: 'completed', label: 'completati', count: stats.succeeded },
    { key: 'dead', label: 'dead-letter', count: stats.dead },
  ]

  const jobsForTab = tab === 'pending' ? pending : tab === 'running' ? running : tab === 'completed' ? completed : tab === 'dead' ? deadLetter : []

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Queue</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Job Queue</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{stats.totalProcessed} processati · {stats.running} attivi</p>
      </div>

      <div className="flex gap-3 mb-6 flex-wrap">
        <StatCard label="in coda" value={stats.queued} color="var(--color-muted)" />
        <StatCard label="in esecuzione" value={stats.running} color="var(--color-yellow)" />
        <StatCard label="completati" value={stats.succeeded} color="var(--color-green)" />
        <StatCard label="falliti" value={stats.failed} color="var(--color-orange)" />
        <StatCard label="dead-letter" value={stats.dead} color="var(--color-red)" />
      </div>

      <div className="flex gap-1 mb-4 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
            style={{ background: tab === t.key ? 'var(--color-row)' : 'transparent', color: tab === t.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${tab === t.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
        {tab === 'dead' && deadLetter.length > 0 && (
          <button onClick={clearDlq} className="ml-auto px-3 py-1 rounded text-[10px] font-semibold text-[var(--color-red)] hover:bg-[rgba(255,69,96,0.1)] cursor-pointer transition-colors">svuota DLQ</button>
        )}
      </div>

      {tab === 'overview' ? (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)] p-6 text-center">
          <p className="text-[var(--color-muted)] text-[12px]">Seleziona un tab per vedere i dettagli dei job.</p>
          <p className="text-[var(--color-dim)] text-[11px] mt-2">Aggiornamento automatico ogni 5 secondi.</p>
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          {jobsForTab.length === 0
            ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun job.</p></div>
            : jobsForTab.map(j => <JobRow key={j.id} job={j} onRetry={tab === 'dead' ? retryJob : undefined} />)
          }
        </div>
      )}
    </div>
  )
}
