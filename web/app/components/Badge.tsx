'use client'

// ── Types ──────────────────────────────────────────────────────────────────

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'outline'
export type BadgeSize    = 'sm' | 'md' | 'lg'

export interface BadgeProps {
  label?:    string
  variant?:  BadgeVariant
  size?:     BadgeSize
  dot?:      boolean        // pallino colorato prefisso (o dot puro se no label)
  removable?: boolean
  onRemove?: () => void
  className?: string
}

// ── Style maps ─────────────────────────────────────────────────────────────

const VARIANT: Record<BadgeVariant, React.CSSProperties> = {
  default: { background: 'var(--color-row)',    color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
  success: { background: 'color-mix(in srgb, var(--color-green) 15%, transparent)',  color: 'var(--color-green)',  border: '1px solid color-mix(in srgb, var(--color-green) 30%, transparent)' },
  warning: { background: 'color-mix(in srgb, var(--color-yellow) 15%, transparent)', color: 'var(--color-yellow)', border: '1px solid color-mix(in srgb, var(--color-yellow) 30%, transparent)' },
  error:   { background: 'color-mix(in srgb, var(--color-red) 15%, transparent)',    color: 'var(--color-red)',    border: '1px solid color-mix(in srgb, var(--color-red) 30%, transparent)' },
  info:    { background: 'color-mix(in srgb, var(--color-blue) 15%, transparent)',   color: 'var(--color-blue)',   border: '1px solid color-mix(in srgb, var(--color-blue) 30%, transparent)' },
  outline: { background: 'transparent', color: 'var(--color-muted)', border: '1px solid var(--color-border)' },
}

const DOT_COLOR: Record<BadgeVariant, string> = {
  default: 'var(--color-dim)',   success: 'var(--color-green)',
  warning: 'var(--color-yellow)', error: 'var(--color-red)',
  info:    'var(--color-blue)',   outline: 'var(--color-muted)',
}

const SIZE_CLS: Record<BadgeSize, string>  = { sm: 'text-[9px] px-2 py-0.5 gap-1', md: 'text-[10px] px-2.5 py-1 gap-1.5', lg: 'text-[11px] px-3 py-1.5 gap-2' }
const DOT_PX:  Record<BadgeSize, number>   = { sm: 6, md: 8, lg: 10 }
const RMV_PX:  Record<BadgeSize, number>   = { sm: 10, md: 12, lg: 14 }
const ICN_PX:  Record<BadgeSize, number>   = { sm: 8, md: 9, lg: 10 }

// ── Badge ──────────────────────────────────────────────────────────────────

export function Badge({
  label, variant = 'default', size = 'md',
  dot = false, removable = false, onRemove, className = '',
}: BadgeProps) {
  // Pure dot — no label, just a colored circle
  if (dot && !label) {
    const px = DOT_PX[size]
    return (
      <span className={`inline-block rounded-full flex-shrink-0 ${className}`}
        style={{ width: px, height: px, background: DOT_COLOR[variant] }} />
    )
  }

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold tracking-wide leading-none select-none ${SIZE_CLS[size]} ${className}`}
      style={VARIANT[variant]}
    >
      {/* Dot prefix */}
      {dot && (
        <span className="rounded-full flex-shrink-0"
          style={{ width: DOT_PX[size], height: DOT_PX[size], background: DOT_COLOR[variant] }} />
      )}

      {/* Label */}
      {label && <span>{label}</span>}

      {/* Remove button */}
      {removable && (
        <button
          onClick={e => { e.stopPropagation(); onRemove?.() }}
          className="flex items-center justify-center rounded-full cursor-pointer border-0 p-0 leading-none transition-opacity hover:opacity-70 bg-transparent"
          style={{ color: 'currentColor', width: RMV_PX[size], height: RMV_PX[size] }}
          aria-label="Rimuovi"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
            style={{ width: ICN_PX[size], height: ICN_PX[size] }}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </span>
  )
}

// ── BadgeGroup ─────────────────────────────────────────────────────────────

export interface BadgeGroupProps {
  badges: BadgeProps[]
  gap?:   'sm' | 'md' | 'lg'
  wrap?:  boolean
}

const GAP: Record<string, string> = { sm: 'gap-1', md: 'gap-1.5', lg: 'gap-2' }

export function BadgeGroup({ badges, gap = 'md', wrap = true }: BadgeGroupProps) {
  return (
    <div className={`flex items-center ${GAP[gap]} ${wrap ? 'flex-wrap' : 'flex-nowrap overflow-hidden'}`}>
      {badges.map((b, i) => <Badge key={i} {...b} />)}
    </div>
  )
}

// ── StatusBadge (shorthand) ────────────────────────────────────────────────

const STATUS_MAP: Record<string, BadgeVariant> = {
  attivo: 'success', completato: 'success', ok: 'success', merged: 'success',
  attenzione: 'warning', 'in-progress': 'warning', pending: 'warning',
  errore: 'error', fallito: 'error', rifiutato: 'error',
  info: 'info', nuovo: 'info', bozza: 'outline',
}

export function StatusBadge({ status, size = 'md' }: { status: string; size?: BadgeSize }) {
  return <Badge label={status} variant={STATUS_MAP[status.toLowerCase()] ?? 'default'} size={size} dot />
}

// ── CountBadge (shorthand per contatori) ──────────────────────────────────

export function CountBadge({ count, max = 99, variant = 'info', size = 'sm' }: { count: number; max?: number; variant?: BadgeVariant; size?: BadgeSize }) {
  return <Badge label={count > max ? `${max}+` : String(count)} variant={variant} size={size} />
}
