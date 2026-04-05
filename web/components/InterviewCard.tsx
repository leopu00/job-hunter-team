export type InterviewType   = 'phone' | 'video' | 'onsite' | 'technical' | 'hr'
export type InterviewStatus = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled'

export interface Interview {
  id: string
  company: string
  role: string
  scheduledAt: number   // ms timestamp
  durationMin?: number
  type: InterviewType
  status: InterviewStatus
  location?: string     // URL per video, indirizzo per onsite
  interviewer?: string
  notes?: string
  feedback?: string
  jobId?: string
}

const TYPE_CFG: Record<InterviewType, { icon: string; label: string; color: string }> = {
  phone:     { icon: '📞', label: 'Telefonico',  color: 'var(--color-muted)'  },
  video:     { icon: '🎥', label: 'Video',       color: 'var(--color-yellow)' },
  onsite:    { icon: '🏢', label: 'In presenza', color: 'var(--color-green)'  },
  technical: { icon: '💻', label: 'Tecnico',     color: 'var(--color-orange)' },
  hr:        { icon: '🤝', label: 'HR',          color: 'var(--color-muted)'  },
}

const STATUS_CFG: Record<InterviewStatus, { label: string; color: string }> = {
  scheduled:   { label: 'programmato',  color: 'var(--color-yellow)' },
  completed:   { label: 'completato',   color: 'var(--color-green)'  },
  cancelled:   { label: 'annullato',    color: 'var(--color-red)'    },
  rescheduled: { label: 'riprogrammato',color: 'var(--color-orange)' },
}

function countdown(ms: number): { label: string; urgent: boolean } {
  const diff = ms - Date.now()
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor(diff / 3600000)
  const mins  = Math.floor(diff / 60000)

  if (diff < 0) {
    const past = Math.abs(days)
    return { label: past === 0 ? 'oggi' : `${past}g fa`, urgent: false }
  }
  if (mins < 60) return { label: `tra ${mins}m`, urgent: true }
  if (hours < 24) return { label: `tra ${hours}h`, urgent: true }
  if (days === 1) return { label: 'domani', urgent: true }
  return { label: `tra ${days} giorni`, urgent: days <= 3 }
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString('it-IT', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export interface InterviewCardProps {
  interview: Interview
  compact?: boolean
  onClick?: (interview: Interview) => void
}

export default function InterviewCard({ interview, compact = false, onClick }: InterviewCardProps) {
  const typeCfg   = TYPE_CFG[interview.type]
  const statusCfg = STATUS_CFG[interview.status]
  const cd        = countdown(interview.scheduledAt)
  const isPast    = interview.scheduledAt < Date.now()

  return (
    <div
      onClick={() => onClick?.(interview)}
      className="border rounded-lg transition-all"
      style={{
        borderColor: interview.status === 'scheduled' && cd.urgent ? `${typeCfg.color}66` : 'var(--color-border)',
        background: 'var(--color-panel)',
        padding: compact ? '12px 16px' : '16px 20px',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = interview.status === 'scheduled' && cd.urgent ? `${typeCfg.color}66` : 'var(--color-border)' }}
    >
      <div className="flex items-start gap-3">
        {/* Tipo icon */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
          <span className="text-xl">{typeCfg.icon}</span>
          {!compact && <span className="text-[8px] font-mono" style={{ color: typeCfg.color }}>{typeCfg.label}</span>}
        </div>

        <div className="flex-1 min-w-0">
          {/* Azienda + ruolo */}
          <p className="text-[13px] font-semibold text-[var(--color-bright)] truncate" title={interview.company}>{interview.company}</p>
          <p className="text-[11px] text-[var(--color-muted)] truncate" title={interview.role}>{interview.role}</p>

          {!compact && (
            <>
              {/* Data + durata */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[10px] font-mono text-[var(--color-dim)]">{fmtDateTime(interview.scheduledAt)}</span>
                {interview.durationMin && (
                  <span className="text-[9px] text-[var(--color-dim)]">· {interview.durationMin}min</span>
                )}
              </div>
              {/* Location / URL */}
              {interview.location && (
                <p className="text-[9px] text-[var(--color-dim)] mt-0.5 truncate" title={interview.location}>{interview.location}</p>
              )}
              {/* Intervistatore */}
              {interview.interviewer && (
                <p className="text-[9px] text-[var(--color-dim)] mt-0.5">👤 {interview.interviewer}</p>
              )}
              {/* Note preview */}
              {interview.notes && (
                <p className="text-[10px] text-[var(--color-dim)] mt-2 line-clamp-2 border-l-2 pl-2 italic"
                  style={{ borderColor: 'var(--color-border)' }}>
                  {interview.notes}
                </p>
              )}
            </>
          )}
        </div>

        {/* Destra: countdown + status */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {/* Countdown */}
          {interview.status === 'scheduled' && (
            <span className="text-[10px] font-mono font-bold"
              style={{ color: cd.urgent ? typeCfg.color : 'var(--color-dim)' }}>
              {cd.label}
            </span>
          )}
          {/* Status badge */}
          <span className="badge text-[9px] font-mono"
            style={{ color: statusCfg.color, border: `1px solid ${statusCfg.color}44`, background: `${statusCfg.color}0d` }}>
            {statusCfg.label}
          </span>
          {/* Feedback dot */}
          {interview.feedback && isPast && (
            <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,232,122,0.08)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.2)' }}>
              feedback ✓
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
