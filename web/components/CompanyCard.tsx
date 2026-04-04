import Link from 'next/link'

export type CompanySize = 'startup' | 'small' | 'medium' | 'large' | 'enterprise'

export interface Company {
  id: string
  name: string
  sector?: string
  size?: CompanySize
  location?: string
  website?: string
  logoUrl?: string
  rating?: number        // 0–5
  reviewCount?: number
  openPositions?: number
  description?: string
  tags?: string[]
  followed?: boolean
}

const SIZE_LABEL: Record<CompanySize, string> = {
  startup:    '1–10',
  small:      '11–50',
  medium:     '51–250',
  large:      '251–1000',
  enterprise: '1000+',
}

const SIZE_ICON: Record<CompanySize, string> = {
  startup: '🌱', small: '🏠', medium: '🏢', large: '🏙️', enterprise: '🌐',
}

function StarRating({ rating, count }: { rating: number; count?: number }) {
  const full  = Math.floor(rating)
  const half  = rating - full >= 0.5
  const empty = 5 - full - (half ? 1 : 0)
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] tracking-tight" style={{ color: 'var(--color-yellow)', letterSpacing: -1 }}>
        {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(empty)}
      </span>
      <span className="text-[9px] font-mono text-[var(--color-dim)]">
        {rating.toFixed(1)}{count !== undefined ? ` (${count})` : ''}
      </span>
    </div>
  )
}

function LogoPlaceholder({ name, logoUrl }: { name: string; logoUrl?: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={name} width={40} height={40}
        className="rounded-lg object-contain flex-shrink-0"
        style={{ background: 'var(--color-border)', padding: 4 }} />
    )
  }
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
  return (
    <div className="flex items-center justify-center rounded-lg flex-shrink-0 text-[13px] font-bold"
      style={{ width: 40, height: 40, background: 'var(--color-border)', color: 'var(--color-muted)', userSelect: 'none' }}>
      {initials}
    </div>
  )
}

export interface CompanyCardProps {
  company: Company
  showDescription?: boolean
  compact?: boolean
  onClick?: (company: Company) => void
}

export default function CompanyCard({ company, showDescription = false, compact = false, onClick }: CompanyCardProps) {
  const inner = (
    <div
      onClick={() => onClick?.(company)}
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
      <div className="flex items-start gap-3">
        <LogoPlaceholder name={company.name} logoUrl={company.logoUrl} />
        <div className="flex-1 min-w-0">
          {/* Nome + followed */}
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[13px] font-semibold text-[var(--color-bright)] truncate">{company.name}</span>
            {company.followed && (
              <span className="text-[8px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: 'rgba(0,232,122,0.08)', border: '1px solid rgba(0,232,122,0.2)', color: 'var(--color-green)' }}>
                seguita
              </span>
            )}
          </div>
          {/* Settore + location */}
          <p className="text-[10px] text-[var(--color-muted)]">
            {company.sector ?? '—'}
            {company.location && <span className="text-[var(--color-dim)]"> · {company.location}</span>}
          </p>
        </div>
        {/* Posizioni aperte */}
        {company.openPositions !== undefined && company.openPositions > 0 && (
          <div className="flex flex-col items-end flex-shrink-0">
            <span className="text-[16px] font-bold text-[var(--color-green)]">{company.openPositions}</span>
            <span className="text-[8px] text-[var(--color-dim)]">posizioni</span>
          </div>
        )}
      </div>

      {!compact && (
        <>
          {/* Descrizione */}
          {showDescription && company.description && (
            <p className="text-[10px] text-[var(--color-dim)] mt-2 line-clamp-2 leading-relaxed">{company.description}</p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {company.size && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                {SIZE_ICON[company.size]} {SIZE_LABEL[company.size]} dipendenti
              </span>
            )}
            {company.rating !== undefined && (
              <StarRating rating={company.rating} count={company.reviewCount} />
            )}
          </div>

          {/* Tags */}
          {company.tags && company.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {company.tags.slice(0, 6).map(tag => (
                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                  style={{ background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.15)', color: 'var(--color-dim)' }}>
                  {tag}
                </span>
              ))}
              {company.tags.length > 6 && <span className="text-[9px] text-[var(--color-dim)]">+{company.tags.length - 6}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )

  return company.website ? (
    <Link href={company.website} target="_blank" rel="noreferrer" className="no-underline block">{inner}</Link>
  ) : inner
}
