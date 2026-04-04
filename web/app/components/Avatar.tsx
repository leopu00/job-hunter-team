'use client'

import { useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type AvatarStatus = 'online' | 'offline' | 'busy' | 'away'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export type AvatarProps = {
  name?:      string
  src?:       string
  status?:    AvatarStatus
  size?:      AvatarSize
  color?:     string      // colore iniziali personalizzato
  square?:    boolean     // bordi squadrati invece di circolari
  className?: string
  onClick?:   () => void
}

// ── Config ─────────────────────────────────────────────────────────────────

const SIZE_CFG: Record<AvatarSize, { px: number; text: string; dot: number; border: number }> = {
  xs: { px: 20, text: '7px',  dot: 5,  border: 1.5 },
  sm: { px: 28, text: '9px',  dot: 6,  border: 1.5 },
  md: { px: 36, text: '11px', dot: 8,  border: 2   },
  lg: { px: 48, text: '14px', dot: 10, border: 2   },
  xl: { px: 64, text: '18px', dot: 12, border: 2.5 },
}

const STATUS_COLOR: Record<AvatarStatus, string> = {
  online:  'var(--color-green)',
  offline: 'var(--color-dim)',
  busy:    'var(--color-red)',
  away:    'var(--color-yellow)',
}

// Genera colore deterministico dalle iniziali
const PALETTE = [
  'var(--color-blue)', 'var(--color-green)', 'var(--color-yellow)',
  'var(--color-red)',  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
]
function nameColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return PALETTE[h % PALETTE.length]
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Avatar ─────────────────────────────────────────────────────────────────

export function Avatar({ name = '', src, status, size = 'md', color, square = false, className, onClick }: AvatarProps) {
  const [imgError, setImgError] = useState(false)
  const cfg     = SIZE_CFG[size]
  const radius  = square ? Math.round(cfg.px * 0.2) : cfg.px / 2
  const acColor = color ?? (name ? nameColor(name) : 'var(--color-dim)')
  const label   = name ? initials(name) : '?'
  const showImg = src && !imgError

  return (
    <div
      className={`relative inline-flex flex-shrink-0 ${onClick ? 'cursor-pointer' : ''} ${className ?? ''}`}
      style={{ width: cfg.px, height: cfg.px }}
      onClick={onClick}
      title={name || undefined}>

      {/* Avatar body */}
      <div className="w-full h-full flex items-center justify-center overflow-hidden select-none"
        style={{
          borderRadius: radius,
          background:   showImg ? 'transparent' : `${acColor}20`,
          border:       `${cfg.border}px solid ${acColor}40`,
        }}>
        {showImg
          ? <img src={src} alt={name} className="w-full h-full object-cover"
              style={{ borderRadius: radius - cfg.border }}
              onError={() => setImgError(true)} />
          : <span className="font-bold select-none leading-none"
              style={{ fontSize: cfg.text, color: acColor }}>
              {label}
            </span>
        }
      </div>

      {/* Status dot */}
      {status && (
        <span className="absolute bottom-0 right-0 rounded-full"
          style={{
            width:      cfg.dot,
            height:     cfg.dot,
            background: STATUS_COLOR[status],
            border:     `${cfg.border}px solid var(--color-void)`,
            transform:  'translate(20%, 20%)',
          }} />
      )}
    </div>
  )
}

// ── AvatarGroup ────────────────────────────────────────────────────────────

type AvatarGroupProps = {
  avatars:    Omit<AvatarProps, 'size'>[]
  size?:      AvatarSize
  max?:       number
  className?: string
}

export function AvatarGroup({ avatars, size = 'sm', max = 5, className }: AvatarGroupProps) {
  const visible  = avatars.slice(0, max)
  const overflow = avatars.length - max
  const cfg      = SIZE_CFG[size]
  const overlap  = Math.round(cfg.px * 0.3)

  return (
    <div className={`flex items-center ${className ?? ''}`}
      style={{ paddingLeft: overlap }}>
      {visible.map((a, i) => (
        <div key={i} style={{ marginLeft: -overlap, zIndex: i }}>
          <Avatar {...a} size={size} />
        </div>
      ))}
      {overflow > 0 && (
        <div className="flex items-center justify-center font-bold flex-shrink-0"
          style={{
            width:        cfg.px, height: cfg.px,
            borderRadius: cfg.px / 2,
            background:   'var(--color-border)',
            border:       `${cfg.border}px solid var(--color-panel)`,
            fontSize:     cfg.text, color: 'var(--color-dim)',
            marginLeft:  -overlap, zIndex: visible.length,
          }}>
          +{overflow}
        </div>
      )}
    </div>
  )
}
