import Link from 'next/link'

export type ApplicationStatus = 'not_applied' | 'applied' | 'screening' | 'interview' | 'offer' | 'rejected' | 'withdrawn'
export type JobType = 'full-time' | 'part-time' | 'contract' | 'remote' | 'hybrid'

export interface JobSalary {
  min?: number
  max?: number
  currency?: string
  period?: 'year' | 'month' | 'hour'
}

export interface Job {
  id: string
  title: string
  company: string
  location: string
  type?: JobType
  salary?: JobSalary
  tags?: string[]
  status?: ApplicationStatus
  postedAt?: number
  url?: string
  description?: string
  score?: number
}

const STATUS_CFG: Record<ApplicationStatus, { label: string; color: string }> = {
  not_applied: { label: 'non candidato',  color: 'var(--color-dim)'    },
  applied:     { label: 'candidato',      color: 'var(--color-yellow)' },
  screening:   { label: 'screening',      color: 'var(--color-yellow)' },
  interview:   { label: 'colloquio',      color: 'var(--color-green)'  },
  offer:       { label: 'offerta 🎉',     color: 'var(--color-green)'  },
  rejected:    { label: 'rifiutato',      color: 'var(--color-red)'    },
  withdrawn:   { label: 'ritirato',       color: 'var(--color-dim)'    },
}

const TYPE_LABEL: Record<JobType, string> = {
  'full-time': 'Full-time', 'part-time': 'Part-time',
  'contract': 'Contratto', 'remote': 'Remote', 'hybrid': 'Ibrido',
}

function fmtSalary(s: JobSalary): string {
  const cur = s.currency ?? '€'
  const per = s.period === 'month' ? '/m' : s.period === 'hour' ? '/h' : '/a'
  if (s.min && s.max) return `${cur}${(s.min / 1000).toFixed(0)}k–${(s.max / 1000).toFixed(0)}k${per}`
  if (s.min) return `da ${cur}${(s.min / 1000).toFixed(0)}k${per}`
  if (s.max) return `fino a ${cur}${(s.max / 1000).toFixed(0)}k${per}`
  return ''
}

function fmtAge(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days === 0) return 'oggi'
  if (days === 1) return 'ieri'
  if (days < 7) return `${days}g fa`
  if (days < 30) return `${Math.floor(days / 7)}sett fa`
  return `${Math.floor(days / 30)}mesi fa`
}

export interface JobCardProps {
  job: Job
  /** Mostra descrizione troncata */
  showDescription?: boolean
  /** Modalità compatta (solo titolo/azienda/badge) */
  compact?: boolean
  onClick?: (job: Job) => void
  className?: string
}

export default function JobCard({ job, showDescription = false, compact = false, onClick }: JobCardProps) {
  const statusCfg = job.status ? STATUS_CFG[job.status] : null
  const salaryStr = job.salary ? fmtSalary(job.salary) : null

  const inner = (
    <div
      onClick={() => onClick?.(job)}
      className="border rounded-lg transition-all"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-panel)',
        padding: compact ? '12px 16px' : '16px 20px',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Titolo + score */}
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[13px] font-semibold text-[var(--color-bright)] truncate" title={job.title}>{job.title}</span>
            {job.score !== undefined && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.2)' }}>
                {job.score}%
              </span>
            )}
          </div>
          {/* Azienda + location */}
          <p className="text-[11px] text-[var(--color-muted)]">
            {job.company}
            {job.location && <span className="text-[var(--color-dim)]"> · {job.location}</span>}
          </p>
        </div>
        {/* Status badge */}
        {statusCfg && (
          <span className="badge text-[9px] font-mono flex-shrink-0"
            style={{ color: statusCfg.color, border: `1px solid ${statusCfg.color}44`, background: `${statusCfg.color}0d` }}>
            {statusCfg.label}
          </span>
        )}
      </div>

      {!compact && (
        <>
          {/* Descrizione */}
          {showDescription && job.description && (
            <p className="text-[10px] text-[var(--color-dim)] mt-2 line-clamp-2 leading-relaxed" title={job.description}>{job.description}</p>
          )}

          {/* Meta row: tipo, salary, data */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {job.type && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                {TYPE_LABEL[job.type]}
              </span>
            )}
            {salaryStr && <span className="text-[10px] font-mono text-[var(--color-green)]">{salaryStr}</span>}
            {job.postedAt && <span className="text-[9px] text-[var(--color-dim)] ml-auto">{fmtAge(job.postedAt)}</span>}
          </div>

          {/* Tags */}
          {job.tags && job.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {job.tags.slice(0, 8).map(tag => (
                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                  style={{ background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.15)', color: 'var(--color-dim)' }}>
                  {tag}
                </span>
              ))}
              {job.tags.length > 8 && <span className="text-[9px] text-[var(--color-dim)]">+{job.tags.length - 8}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )

  return job.url ? (
    <Link href={job.url} target="_blank" rel="noreferrer" className="no-underline block">{inner}</Link>
  ) : inner
}
