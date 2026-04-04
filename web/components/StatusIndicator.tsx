'use client'

import { useEffect } from 'react'

export type Status = 'online' | 'offline' | 'busy' | 'away' | 'error'
export type StatusSize = 'sm' | 'md' | 'lg'

export interface StatusIndicatorProps {
  status: Status
  label?: string
  /** Mostra label testuale a fianco */
  showLabel?: boolean
  pulse?: boolean
  size?: StatusSize
  /** Testo custom invece del nome stato */
  labelOverride?: string
}

const STATUS_CONFIG: Record<Status, { color: string; label: string; icon: string }> = {
  online:  { color: 'var(--color-green)', label: 'Online',   icon: '●' },
  offline: { color: 'var(--color-dim)',   label: 'Offline',  icon: '●' },
  busy:    { color: '#f59e0b',            label: 'Occupato', icon: '●' },
  away:    { color: '#fb923c',            label: 'Assente',  icon: '●' },
  error:   { color: 'var(--color-red)',   label: 'Errore',   icon: '●' },
}

const SIZE_CONFIG: Record<StatusSize, { dot: number; ring: number; fontSize: number }> = {
  sm: { dot: 6,  ring: 12, fontSize: 9  },
  md: { dot: 9,  ring: 18, fontSize: 11 },
  lg: { dot: 12, ring: 24, fontSize: 13 },
}

/* ── Keyframe iniettato una sola volta ── */
function ensureKeyframes() {
  if (typeof document === 'undefined' || document.getElementById('status-kf')) return
  const s = document.createElement('style')
  s.id = 'status-kf'
  s.textContent = `
    @keyframes status-pulse {
      0%   { transform: scale(1);   opacity: 0.8; }
      50%  { transform: scale(1.9); opacity: 0; }
      100% { transform: scale(1);   opacity: 0; }
    }
    @keyframes status-blink {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.3; }
    }
  `
  document.head.appendChild(s)
}

export default function StatusIndicator({
  status,
  label,
  showLabel = false,
  pulse = status === 'online',
  size = 'md',
  labelOverride,
}: StatusIndicatorProps) {
  useEffect(() => { ensureKeyframes() }, [])

  const cfg  = STATUS_CONFIG[status]
  const sz   = SIZE_CONFIG[size]
  const text = labelOverride ?? label ?? cfg.label

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: sz.fontSize * 0.6 }}>
      {/* Dot container */}
      <div style={{ position: 'relative', width: sz.ring, height: sz.ring, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {/* Anello pulse */}
        {pulse && (
          <span style={{
            position: 'absolute',
            width: sz.dot, height: sz.dot,
            borderRadius: '50%',
            background: cfg.color,
            animation: 'status-pulse 1.8s ease-out infinite',
          }} />
        )}
        {/* Dot principale */}
        <span style={{
          display: 'block',
          width: sz.dot, height: sz.dot,
          borderRadius: '50%',
          background: cfg.color,
          flexShrink: 0,
          animation: status === 'error' ? 'status-blink 1s ease-in-out infinite' : 'none',
          boxShadow: status !== 'offline' ? `0 0 0 2px var(--color-panel), 0 0 6px ${cfg.color}55` : `0 0 0 2px var(--color-panel)`,
        }} />
      </div>

      {/* Label */}
      {showLabel && (
        <span style={{ fontSize: sz.fontSize, color: cfg.color, fontWeight: 500, whiteSpace: 'nowrap' }}>
          {text}
        </span>
      )}
    </div>
  )
}

/* ── StatusBadge — versione con sfondo pill ── */
export function StatusBadge({ status, size = 'md', labelOverride }: Pick<StatusIndicatorProps, 'status' | 'size' | 'labelOverride'>) {
  useEffect(() => { ensureKeyframes() }, [])
  const cfg = STATUS_CONFIG[status]
  const sz  = SIZE_CONFIG[size]
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: `${sz.fontSize * 0.2}px ${sz.fontSize * 0.7}px`,
      borderRadius: 20,
      background: `${cfg.color}18`,
      border: `1px solid ${cfg.color}44`,
    }}>
      <StatusIndicator status={status} size={size === 'lg' ? 'sm' : 'sm'} pulse={status === 'online'} />
      <span style={{ fontSize: sz.fontSize, color: cfg.color, fontWeight: 600 }}>
        {labelOverride ?? cfg.label}
      </span>
    </div>
  )
}
