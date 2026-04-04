'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type RunStatus = 'success' | 'failure' | 'running' | 'cancelled' | 'unknown'
type Pipeline  = { id: string; name: string; file: string; trigger: string; status: RunStatus; duration?: number; startedAt?: number; runUrl?: string; runNumber?: number }
type PipeRes   = { pipelines: Pipeline[]; source: 'github' | 'static'; repo: string }

const STATUS_CFG: Record<RunStatus, { label: string; color: string; icon: string }> = {
  success:   { label: 'successo',   color: 'var(--color-green)',  icon: '✓' },
  failure:   { label: 'fallita',    color: 'var(--color-red)',    icon: '✕' },
  running:   { label: 'in corso',   color: 'var(--color-yellow)', icon: '◉' },
  cancelled: { label: 'annullata',  color: 'var(--color-dim)',    icon: '⊘' },
  unknown:   { label: 'sconosciuto',color: 'var(--color-border)', icon: '?' },
}

const WORKFLOW_ICON: Record<string, string> = {
  'ci.yml': '🔧', 'test.yml': '🧪', 'lint.yml': '✏️',
  'security.yml': '🔒', 'deploy.yml': '🚀', 'release.yml': '🏷️',
}

function fmtDuration(s?: number) {
  if (!s) return '—'
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function fmtAgo(ms?: number) {
  if (!ms) return '—'
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return 'adesso'
  if (m < 60) return `${m}m fa`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h fa`
  return new Date(ms).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

function StatusBadge({ status }: { status: RunStatus }) {
  const cfg = STATUS_CFG[status]
  const pulse = status === 'running'
  return (
    <span className="flex items-center gap-1.5 badge text-[9px] font-mono"
      style={{ color: cfg.color, border: `1px solid ${cfg.color}44`, background: `${cfg.color}0d` }}>
      {pulse
        ? <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: cfg.color, animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
        : <span>{cfg.icon}</span>
      }
      {cfg.label}
    </span>
  )
}

export default function PipelinesPage() {
  const [data, setData]       = useState<PipeRes | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/pipelines')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  const counts = data
    ? { success: data.pipelines.filter(p => p.status === 'success').length, failure: data.pipelines.filter(p => p.status === 'failure').length, running: data.pipelines.filter(p => p.status === 'running').length }
    : { success: 0, failure: 0, running: 0 }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Pipelines</span>
        </div>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Pipelines</h1>
            {data && (
              <p className="text-[var(--color-muted)] text-[11px] mt-1">
                {counts.success > 0 && <span style={{ color: 'var(--color-green)' }}>{counts.success} ok</span>}
                {counts.success > 0 && (counts.failure > 0 || counts.running > 0) && ' · '}
                {counts.failure > 0 && <span style={{ color: 'var(--color-red)' }}>{counts.failure} fallite</span>}
                {counts.failure > 0 && counts.running > 0 && ' · '}
                {counts.running > 0 && <span style={{ color: 'var(--color-yellow)' }}>{counts.running} in corso</span>}
                {data.source === 'static' && <span className="text-[var(--color-dim)]"> · dati statici (imposta GITHUB_TOKEN per dati live)</span>}
              </p>
            )}
          </div>
          {data && <a href={`https://github.com/${data.repo}/actions`} target="_blank" rel="noreferrer"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            GitHub Actions ↗
          </a>}
        </div>
      </div>

      {loading && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span></div>}

      {!loading && data && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          {data.pipelines.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-4 px-5 py-4 ${i < data.pipelines.length - 1 ? 'border-b' : ''}`} style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-xl flex-shrink-0">{WORKFLOW_ICON[p.file] ?? '⚙️'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[12px] font-semibold text-[var(--color-bright)]">{p.name}</span>
                  {p.runNumber && <span className="text-[9px] font-mono text-[var(--color-dim)]">#{p.runNumber}</span>}
                </div>
                <p className="text-[9px] font-mono text-[var(--color-dim)]">{p.file} · {p.trigger}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-[10px] text-[var(--color-dim)] hidden sm:block">{fmtDuration(p.duration)}</span>
                <span className="text-[10px] text-[var(--color-dim)] hidden sm:block">{fmtAgo(p.startedAt)}</span>
                <StatusBadge status={p.status} />
                {p.runUrl && (
                  <a href={p.runUrl} target="_blank" rel="noreferrer"
                    className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">↗</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
