'use client'

export type BadgeStatus = 'ok' | 'error' | 'warning' | 'unknown' | 'active' | 'idle' | 'running' | 'stopped' | 'pending'

const STATUS_CFG: Record<BadgeStatus, { color: string; bg: string; border: string; label: string }> = {
  ok:      { color: 'var(--color-green)',  bg: 'rgba(0,232,122,0.08)',   border: 'rgba(0,232,122,0.25)',  label: 'ok' },
  active:  { color: 'var(--color-green)',  bg: 'rgba(0,232,122,0.08)',   border: 'rgba(0,232,122,0.25)',  label: 'attivo' },
  running: { color: 'var(--color-green)',  bg: 'rgba(0,232,122,0.08)',   border: 'rgba(0,232,122,0.25)',  label: 'in esecuzione' },
  warning: { color: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.08)',  border: 'rgba(245,197,24,0.25)', label: 'attenzione' },
  pending: { color: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.08)',  border: 'rgba(245,197,24,0.25)', label: 'in attesa' },
  error:   { color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.08)',   border: 'rgba(255,69,96,0.25)',  label: 'errore' },
  stopped: { color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.08)',   border: 'rgba(255,69,96,0.25)',  label: 'fermato' },
  idle:    { color: 'var(--color-dim)',    bg: 'transparent',             border: 'var(--color-border)',   label: 'inattivo' },
  unknown: { color: 'var(--color-dim)',    bg: 'transparent',             border: 'var(--color-border)',   label: 'sconosciuto' },
}

type Props = {
  status: BadgeStatus
  label?: string
  pulse?: boolean
  size?: 'xs' | 'sm' | 'md'
}

export function StatusBadge({ status, label, pulse, size = 'sm' }: Props) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.unknown
  const fontSize = size === 'xs' ? '9px' : size === 'sm' ? '10px' : '11px'
  const isGreen = status === 'ok' || status === 'active' || status === 'running'
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono font-semibold"
      style={{ fontSize, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      <span style={{ color: cfg.color, animation: pulse && isGreen ? 'pulse-dot 2.5s ease-in-out infinite' : undefined }}>●</span>
      {label ?? cfg.label}
    </span>
  )
}
