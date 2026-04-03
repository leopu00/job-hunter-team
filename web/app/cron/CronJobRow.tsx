'use client'

import type { CronJob } from './types'
import { scheduleLabel, nextRunLabel } from './types'

interface Props {
  job:      CronJob
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}

const STATUS_COLOR: Record<string, string> = {
  ok:      'var(--color-green)',
  error:   'var(--color-red)',
  skipped: 'var(--color-yellow)',
}

export function CronJobRow({ job, onToggle, onDelete }: Props) {
  const statusColor = job.state.lastRunStatus ? STATUS_COLOR[job.state.lastRunStatus] : 'var(--color-dim)'

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-[var(--color-border)] last:border-0"
      style={{ background: job.enabled ? 'transparent' : 'rgba(0,0,0,0.15)' }}>
      {/* Riga principale */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            {/* Dot stato */}
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: job.enabled ? 'var(--color-green)' : 'var(--color-border)' }} />
            <span className="text-[12px] font-semibold truncate"
              style={{ color: job.enabled ? 'var(--color-bright)' : 'var(--color-dim)' }}>
              {job.name}
            </span>
          </div>
          {job.description && (
            <p className="text-[10px] pl-3.5 truncate" style={{ color: 'var(--color-dim)' }}>
              {job.description}
            </p>
          )}
        </div>

        {/* Azioni */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => onToggle(job.id, !job.enabled)}
            className="px-2.5 py-1 rounded text-[10px] font-semibold tracking-wide cursor-pointer transition-all"
            style={job.enabled
              ? { background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.3)' }
              : { background: 'var(--color-card)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
            {job.enabled ? 'pausa' : 'riprendi'}
          </button>
          <button onClick={() => onDelete(job.id)}
            className="px-2.5 py-1 rounded text-[10px] font-semibold cursor-pointer transition-all"
            style={{ background: 'rgba(255,69,96,0.08)', color: 'var(--color-red)', border: '1px solid rgba(255,69,96,0.25)' }}>
            elimina
          </button>
        </div>
      </div>

      {/* Metadati */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-3.5">
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-muted)' }}>
          {scheduleLabel(job.schedule)}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-dim)' }}>
          prossima: <span style={{ color: 'var(--color-base)' }}>{nextRunLabel(job.state.nextRunAtMs)}</span>
        </span>
        {job.state.lastRunStatus && (
          <span className="text-[10px]" style={{ color: statusColor }}>
            ultimo: {job.state.lastRunStatus}
            {job.state.lastDurationMs ? ` (${job.state.lastDurationMs}ms)` : ''}
          </span>
        )}
        {job.state.lastError && (
          <span className="text-[10px] truncate max-w-[200px]" style={{ color: 'var(--color-red)' }}
            title={job.state.lastError}>
            {job.state.lastError}
          </span>
        )}
      </div>

      {/* Payload */}
      <div className="pl-3.5">
        <code className="text-[10px] font-mono px-2 py-0.5 rounded"
          style={{ background: 'var(--color-card)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          {job.payload.command}
        </code>
      </div>
    </div>
  )
}
