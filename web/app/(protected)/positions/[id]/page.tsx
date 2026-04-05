import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPositionById } from '@/lib/queries'
import type { PositionHighlight } from '@/lib/types'

const STATUS_COLORS: Record<string, string> = {
  new:      'var(--color-muted)',
  checked:  'var(--color-blue)',
  scored:   'var(--color-purple)',
  writing:  'var(--color-yellow)',
  review:   'var(--color-orange)',
  ready:    '#7fffb2',
  applied:  'var(--color-green)',
  response: '#58a6ff',
  excluded: 'var(--color-red)',
}

function scoreColor(s: number | null) {
  if (!s) return 'var(--color-dim)'
  if (s >= 75) return 'var(--color-green)'
  if (s >= 55) return 'var(--color-yellow)'
  return 'var(--color-red)'
}

function ScoreBar({ label, value, max }: { label: string; value: number | null; max: number }) {
  const pct = value ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-[var(--color-dim)] w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: scoreColor(value) }}
        />
      </div>
      <span className="text-[11px] font-semibold w-8 text-right" style={{ color: scoreColor(value) }}>
        {value ?? '—'}
      </span>
    </div>
  )
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PositionDetailPage({ params }: PageProps) {
  const { id } = await params
  const data = await getPositionById(id)

  if (!data) notFound()

  const { position, score, highlights, company, application } = data
  const pros = highlights.filter((h: PositionHighlight) => h.type === 'pro')
  const cons = highlights.filter((h: PositionHighlight) => h.type === 'con')

  const statusColor = STATUS_COLORS[position.status] ?? 'var(--color-dim)'

  function formatSalary(min: number | null, max: number | null, currency?: string | null) {
    if (!min && !max) return null
    const c = currency ?? 'EUR'
    if (min && max) return `${c} ${min.toLocaleString()} – ${max.toLocaleString()}`
    if (min) return `${c} ${min.toLocaleString()}+`
    return null
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Breadcrumb ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 text-[10px]">
        <Link href="/dashboard" className="text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
        <span className="text-[var(--color-border)]">/</span>
        <Link href="/positions" className="text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Posizioni</Link>
        <span className="text-[var(--color-border)]">/</span>
        <span className="text-[var(--color-muted)]">{position.legacy_id ? `JHT-${String(position.legacy_id).padStart(3, '0')}` : position.id.slice(0, 8)}</span>
      </div>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mb-1">
              {position.title}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[var(--color-base)] font-medium">{position.company}</span>
              {position.location && (
                <span className="text-[11px] text-[var(--color-muted)]">· {position.location}</span>
              )}
              {position.remote_type && (
                <span className="text-[10px]" style={{
                  color: position.remote_type === 'full_remote'
                    ? 'var(--color-green)'
                    : position.remote_type === 'hybrid'
                    ? 'var(--color-yellow)'
                    : 'var(--color-red)',
                }}>
                  {position.remote_type.replace('_', ' ')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-[10px] font-semibold px-3 py-1 rounded-full border"
              style={{ color: statusColor, borderColor: statusColor, background: `${statusColor}18` }}
            >
              {position.status}
            </span>
            {score && (
              <div className="flex items-center gap-2">
                <div
                  className="w-12 h-12 rounded-full border-2 flex items-center justify-center font-bold text-lg"
                  style={{ borderColor: scoreColor(score.total_score), color: scoreColor(score.total_score) }}
                >
                  {score.total_score}
                </div>
              </div>
            )}
            {position.url && (
              <a
                href={position.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                style={{ borderColor: 'var(--color-blue)', color: 'var(--color-blue)' }}
              >
                Annuncio originale ↗
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left column ─────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Pro/Con highlights */}
          {(pros.length > 0 || cons.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {pros.length > 0 && (
                <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
                  <div className="text-[9.5px] font-semibold tracking-[0.14em] uppercase mb-3" style={{ color: 'var(--color-green)' }}>
                    Pro
                  </div>
                  <ul className="space-y-2">
                    {pros.map((h: PositionHighlight) => (
                      <li key={h.id} className="flex gap-2 text-[11px] text-[var(--color-base)] leading-relaxed">
                        <span style={{ color: 'var(--color-green)' }} className="shrink-0 mt-0.5">+</span>
                        {h.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cons.length > 0 && (
                <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
                  <div className="text-[9.5px] font-semibold tracking-[0.14em] uppercase mb-3" style={{ color: 'var(--color-red)' }}>
                    Contro
                  </div>
                  <ul className="space-y-2">
                    {cons.map((h: PositionHighlight) => (
                      <li key={h.id} className="flex gap-2 text-[11px] text-[var(--color-base)] leading-relaxed">
                        <span style={{ color: 'var(--color-red)' }} className="shrink-0 mt-0.5">−</span>
                        {h.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Score breakdown */}
          {score && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-4">Score breakdown</div>
              <div className="space-y-3">
                <ScoreBar label="Stack match"    value={score.stack_match}    max={40} />
                <ScoreBar label="Remote fit"     value={score.remote_fit}     max={25} />
                <ScoreBar label="Salary fit"     value={score.salary_fit}     max={20} />
                <ScoreBar label="Experience fit" value={score.experience_fit} max={10} />
                <ScoreBar label="Strategic fit"  value={score.strategic_fit}  max={15} />
              </div>
              {score.notes && (
                <p className="mt-4 text-[11px] text-[var(--color-muted)] leading-relaxed border-t border-[var(--color-border)] pt-3">
                  {score.notes}
                </p>
              )}
            </div>
          )}

          {/* Application */}
          {application && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-4">Candidatura</div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <InfoRow label="Stato" value={application.status} />
                <InfoRow label="Critico" value={application.critic_verdict ?? '—'} />
                <InfoRow label="Scritta" value={application.written_at ? application.written_at.slice(0, 10) : '—'} />
                <InfoRow label="Inviata" value={application.applied_at ? application.applied_at.slice(0, 10) : '—'} />
                {application.applied_via && <InfoRow label="Via" value={application.applied_via} />}
                {application.interview_round && <InfoRow label="Round colloquio" value={`#${application.interview_round}`} />}
              </div>
              {/* Drive links */}
              <div className="flex gap-3 flex-wrap">
                {application.cv_drive_id && (
                  <a
                    href={`https://drive.google.com/file/d/${application.cv_drive_id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                    style={{ borderColor: 'var(--color-green)', color: 'var(--color-green)' }}
                  >
                    CV (Drive) ↗
                  </a>
                )}
                {application.cl_drive_id && (
                  <a
                    href={`https://drive.google.com/file/d/${application.cl_drive_id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                    style={{ borderColor: 'var(--color-blue)', color: 'var(--color-blue)' }}
                  >
                    Cover Letter (Drive) ↗
                  </a>
                )}
              </div>
              {application.response && (
                <div className="mt-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
                  <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-1">Risposta ricevuta</div>
                  <p className="text-[11px] text-[var(--color-base)]">{application.response}</p>
                  {application.response_at && (
                    <span className="text-[10px] text-[var(--color-dim)]">{application.response_at.slice(0, 10)}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Job description */}
          {(position.jd_text || position.requirements) && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-3">Job Description</div>
              {position.requirements && (
                <div className="mb-4">
                  <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">Requisiti</div>
                  <pre className="text-[11px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap font-sans">
                    {position.requirements.slice(0, 2000)}{position.requirements.length > 2000 ? '…' : ''}
                  </pre>
                </div>
              )}
              {position.jd_text && (
                <div>
                  <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">Descrizione completa</div>
                  <pre className="text-[11px] text-[var(--color-muted)] leading-relaxed whitespace-pre-wrap font-sans">
                    {position.jd_text.slice(0, 3000)}{position.jd_text.length > 3000 ? '…' : ''}
                  </pre>
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Right column ────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Details */}
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
            <div className="section-label mb-3">Dettagli</div>
            <div className="space-y-2">
              {position.source && <InfoRow label="Fonte" value={position.source} />}
              <InfoRow label="Trovata" value={position.found_at.slice(0, 10)} />
              {position.deadline && <InfoRow label="Scadenza" value={position.deadline} />}
              {position.found_by && <InfoRow label="Trovata da" value={position.found_by} />}
              {formatSalary(position.salary_declared_min, position.salary_declared_max, position.salary_declared_currency) && (
                <InfoRow
                  label="Stipendio dichiarato"
                  value={formatSalary(position.salary_declared_min, position.salary_declared_max, position.salary_declared_currency)!}
                />
              )}
              {formatSalary(position.salary_estimated_min, position.salary_estimated_max, position.salary_estimated_currency) && (
                <InfoRow
                  label="Stipendio stimato"
                  value={formatSalary(position.salary_estimated_min, position.salary_estimated_max, position.salary_estimated_currency)!}
                />
              )}
            </div>
            {position.url && (
              <a
                href={position.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center gap-1 text-[10px] font-semibold text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
              >
                Vedi offerta originale ↗
              </a>
            )}
          </div>

          {/* Company */}
          {company && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-3">Azienda</div>
              <div className="space-y-2">
                {company.verdict && (
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded border"
                      style={{
                        color: company.verdict === 'GO'
                          ? 'var(--color-green)'
                          : company.verdict === 'CAUTIOUS'
                          ? 'var(--color-yellow)'
                          : 'var(--color-red)',
                        borderColor: company.verdict === 'GO'
                          ? 'var(--color-green)'
                          : company.verdict === 'CAUTIOUS'
                          ? 'var(--color-yellow)'
                          : 'var(--color-red)',
                      }}
                    >
                      {company.verdict}
                    </span>
                    {company.glassdoor_rating && (
                      <span className="text-[10px] text-[var(--color-muted)]">
                        Glassdoor: {company.glassdoor_rating}/5
                      </span>
                    )}
                  </div>
                )}
                {company.hq && <InfoRow label="HQ" value={company.hq} />}
                {company.sector && <InfoRow label="Settore" value={company.sector} />}
                {company.size && <InfoRow label="Dimensione" value={company.size} />}
                {company.culture_notes && (
                  <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mt-2">
                    {company.culture_notes}
                  </p>
                )}
                {company.red_flags && (
                  <p className="text-[11px] leading-relaxed mt-2" style={{ color: 'var(--color-red)' }}>
                    ⚠ {company.red_flags}
                  </p>
                )}
              </div>
              {company.website && (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1 text-[10px] font-semibold text-[var(--color-blue)] hover:text-[var(--color-bright)] no-underline transition-colors"
                >
                  Sito aziendale ↗
                </a>
              )}
            </div>
          )}

          {/* Notes */}
          {position.notes && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
              <div className="section-label mb-2">Note</div>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">{position.notes}</p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-[var(--color-dim)] shrink-0">{label}</span>
      <span className="text-[11px] text-[var(--color-base)] text-right">{value}</span>
    </div>
  )
}
