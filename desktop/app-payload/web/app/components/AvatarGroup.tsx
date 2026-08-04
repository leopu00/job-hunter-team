'use client'

import { useState } from 'react'
import { Avatar } from './Avatar'
import type { AvatarSize } from './Avatar'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AvatarGroupItem {
  name?:  string
  src?:   string
  color?: string
}

export type AvatarGroupSize = 'sm' | 'md' | 'lg'

export interface AvatarGroupProps {
  items:      AvatarGroupItem[]
  max?:       number            // max avatar visibili, default 4
  size?:      AvatarGroupSize
  spacing?:   number            // overlap negativo in px, default -8
  showTooltip?: boolean
  className?: string
}

// ── Size map ───────────────────────────────────────────────────────────────

const SIZE_MAP: Record<AvatarGroupSize, { avatar: AvatarSize; px: number; text: string }> = {
  sm: { avatar: 'sm', px: 28, text: '9px'  },
  md: { avatar: 'md', px: 36, text: '11px' },
  lg: { avatar: 'lg', px: 48, text: '14px' },
}

// ── Tooltip ────────────────────────────────────────────────────────────────

function Tip({ name }: { name: string }) {
  return (
    <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
      marginBottom: 6, background: 'var(--color-deep)', border: '1px solid var(--color-border)',
      borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10 }}>
      <span style={{ fontSize: 9, color: 'var(--color-bright)', fontFamily: 'var(--font-mono)' }}>{name}</span>
    </div>
  )
}

// ── Single avatar wrapper con tooltip ─────────────────────────────────────

function AvatarItem({ item, size, showTooltip, zIndex }: {
  item: AvatarGroupItem; size: AvatarGroupSize; showTooltip: boolean; zIndex: number
}) {
  const [tip, setTip] = useState(false)
  const cfg = SIZE_MAP[size]
  return (
    <div style={{ position: 'relative', zIndex, flexShrink: 0 }}
      onMouseEnter={() => showTooltip && item.name ? setTip(true) : undefined}
      onMouseLeave={() => setTip(false)}>
      {tip && item.name && <Tip name={item.name} />}
      <div style={{ boxShadow: '0 0 0 2px var(--color-card)', borderRadius: '50%', display: 'inline-flex' }}>
        <Avatar name={item.name} src={item.src} color={item.color} size={cfg.avatar} />
      </div>
    </div>
  )
}

// ── Overflow badge ─────────────────────────────────────────────────────────

function OverflowBadge({ count, size, names, zIndex }: {
  count: number; size: AvatarGroupSize; names: string[]; zIndex: number
}) {
  const [tip, setTip] = useState(false)
  const cfg = SIZE_MAP[size]
  return (
    <div style={{ position: 'relative', zIndex, flexShrink: 0 }}
      onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
      {tip && names.length > 0 && (
        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, background: 'var(--color-deep)', border: '1px solid var(--color-border)',
          borderRadius: 4, padding: '4px 8px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10 }}>
          {names.map((n, i) => (
            <div key={i} style={{ fontSize: 9, color: 'var(--color-bright)', fontFamily: 'var(--font-mono)' }}>{n}</div>
          ))}
        </div>
      )}
      <div style={{ width: cfg.px, height: cfg.px, borderRadius: '50%', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        background: 'var(--color-row)', border: '1px solid var(--color-border)',
        boxShadow: '0 0 0 2px var(--color-card)' }}>
        <span style={{ fontSize: cfg.text, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          +{count}
        </span>
      </div>
    </div>
  )
}

// ── AvatarGroup ────────────────────────────────────────────────────────────

export function AvatarGroup({
  items, max = 4, size = 'md', spacing = -8,
  showTooltip = true, className = '',
}: AvatarGroupProps) {
  const visible  = items.slice(0, max)
  const overflow = items.slice(max)

  return (
    <div className={`inline-flex items-center ${className}`} style={{ gap: spacing }}>
      {visible.map((item, i) => (
        <AvatarItem key={i} item={item} size={size} showTooltip={showTooltip} zIndex={visible.length - i} />
      ))}
      {overflow.length > 0 && (
        <OverflowBadge
          count={overflow.length}
          size={size}
          names={overflow.map(o => o.name ?? '').filter(Boolean)}
          zIndex={0}
        />
      )}
    </div>
  )
}
