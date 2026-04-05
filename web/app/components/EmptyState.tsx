'use client'

import { type ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type EmptyVariant = 'default' | 'search' | 'error' | 'empty' | 'locked'

type EmptyStateProps = {
  variant?:      EmptyVariant
  icon?:         ReactNode      // emoji string o componente
  title?:        string
  description?:  string
  actionLabel?:  string
  onAction?:     () => void
  secondaryLabel?: string
  onSecondary?:  () => void
  size?:         'sm' | 'md' | 'lg'
  className?:    string
}

// ── Variant presets ────────────────────────────────────────────────────────

const PRESETS: Record<EmptyVariant, { icon: string; title: string; description: string; color: string }> = {
  default: { icon: '📭', title: 'Nessun dato',          description: 'Non ci sono elementi da mostrare.',          color: 'var(--color-dim)'    },
  search:  { icon: '🔍', title: 'Nessun risultato',     description: 'Prova a modificare i filtri o la ricerca.',   color: 'var(--color-muted)'  },
  error:   { icon: '⚠',  title: 'Qualcosa è andato male', description: 'Si è verificato un errore. Riprova.',       color: 'var(--color-red)'    },
  empty:   { icon: '✨', title: 'Ancora vuoto',          description: 'Inizia aggiungendo il primo elemento.',       color: 'var(--color-blue)'   },
  locked:  { icon: '🔒', title: 'Accesso limitato',      description: 'Non hai i permessi per vedere questo contenuto.', color: 'var(--color-dim)' },
}

// ── Size config ────────────────────────────────────────────────────────────

const SIZE_CFG = {
  sm: { py: 'py-8',  icon: 'text-[28px]', title: 'text-[12px]', desc: 'text-[10px]', btn: 'text-[10px] px-3 py-1.5' },
  md: { py: 'py-14', icon: 'text-[40px]', title: 'text-[14px]', desc: 'text-[11px]', btn: 'text-[11px] px-4 py-2'   },
  lg: { py: 'py-20', icon: 'text-[52px]', title: 'text-[16px]', desc: 'text-[12px]', btn: 'text-[12px] px-5 py-2.5' },
}

// ── EmptyState ─────────────────────────────────────────────────────────────

export function EmptyState({
  variant = 'default', icon, title, description,
  actionLabel, onAction, secondaryLabel, onSecondary,
  size = 'md', className,
}: EmptyStateProps) {
  const preset = PRESETS[variant]
  const cfg    = SIZE_CFG[size]

  const resolvedIcon  = icon  ?? preset.icon
  const resolvedTitle = title ?? preset.title
  const resolvedDesc  = description ?? preset.description
  const accentColor   = variant === 'error' ? 'var(--color-red)' : variant === 'empty' ? 'var(--color-blue)' : 'var(--color-green)'

  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-4 text-center ${cfg.py} ${className ?? ''}`}>

      {/* Icon */}
      <div className={`${cfg.icon} select-none`} style={{ opacity: 0.45, lineHeight: 1 }}>
        {resolvedIcon}
      </div>

      {/* Text */}
      <div className="flex flex-col gap-1.5 max-w-xs">
        <p className={`${cfg.title} font-semibold`} style={{ color: 'var(--color-muted)' }}>
          {resolvedTitle}
        </p>
        {resolvedDesc && (
          <p className={`${cfg.desc} leading-relaxed`} style={{ color: 'var(--color-dim)' }}>
            {resolvedDesc}
          </p>
        )}
      </div>

      {/* Actions */}
      {(actionLabel || secondaryLabel) && (
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {actionLabel && onAction && (
            <button onClick={onAction}
              className={`${cfg.btn} rounded-lg font-semibold transition-all hover:opacity-80`}
              style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}44` }}>
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button onClick={onSecondary}
              className={`${cfg.btn} rounded-lg font-semibold transition-all hover:opacity-80`}
              style={{ background: 'transparent', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Varianti shorthand ─────────────────────────────────────────────────────

type ShortProps = Omit<EmptyStateProps, 'variant'>

export const EmptySearch = (p: ShortProps) => <EmptyState variant="search" {...p} />
export const EmptyError  = (p: ShortProps) => <EmptyState variant="error"  {...p} />
export const EmptyNew    = (p: ShortProps) => <EmptyState variant="empty"  {...p} />
export const EmptyLocked = (p: ShortProps) => <EmptyState variant="locked" {...p} />
