'use client'

import { useState, useEffect } from 'react'

// ── Helpers ────────────────────────────────────────────────────────────────

function remaining(target: Date): number {
  return Math.max(0, target.getTime() - Date.now())
}

function fmt(ms: number): { days: number; hours: number; minutes: number; seconds: number } {
  const s = Math.floor(ms / 1000)
  return {
    days:    Math.floor(s / 86400),
    hours:   Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  }
}

function urgencyColor(ms: number): string {
  const days = ms / 86400000
  if (ms === 0)   return 'var(--color-dim)'
  if (days < 3)   return 'var(--color-red)'
  if (days < 7)   return 'var(--color-yellow)'
  return 'var(--color-green)'
}

function urgencyLabel(ms: number): string {
  const days = ms / 86400000
  if (ms === 0)   return 'Scaduto'
  if (days < 1)   return 'Urgente'
  if (days < 3)   return 'Imminente'
  if (days < 7)   return 'In scadenza'
  return 'In programma'
}

function pad(n: number) { return String(n).padStart(2, '0') }

// ── CountdownTimer ─────────────────────────────────────────────────────────

export type CountdownTimerProps = {
  target:      string | Date    // ISO string o Date
  label?:      string           // es. "Colloquio Google"
  showSeconds?: boolean
  showLabel?:  boolean
  size?:       'sm' | 'md' | 'lg'
  className?:  string
}

export function CountdownTimer({
  target, label, showSeconds = false, showLabel = true, size = 'md', className,
}: CountdownTimerProps) {
  const targetDate  = target instanceof Date ? target : new Date(target)
  const [ms, setMs] = useState(() => remaining(targetDate))

  useEffect(() => {
    if (ms === 0) return
    const id = setInterval(() => {
      const r = remaining(targetDate)
      setMs(r)
      if (r === 0) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [targetDate, ms === 0])     // eslint-disable-line react-hooks/exhaustive-deps

  const { days, hours, minutes, seconds } = fmt(ms)
  const color   = urgencyColor(ms)
  const status  = urgencyLabel(ms)
  const pulse   = ms > 0 && ms < 86400000   // < 24h
  const expired = ms === 0

  const sizes = {
    sm: { digit: 'text-[16px]', label: 'text-[8px]', unit: 'text-[7px]', sep: 'text-[14px]' },
    md: { digit: 'text-[22px]', label: 'text-[9px]', unit: 'text-[8px]', sep: 'text-[20px]' },
    lg: { digit: 'text-[32px]', label: 'text-[10px]', unit: 'text-[9px]', sep: 'text-[28px]' },
  }[size]

  return (
    <div className={`flex flex-col items-center gap-1 ${className ?? ''}`}
      style={{ opacity: expired ? 0.5 : 1 }}>

      {/* Label */}
      {label && (
        <p className={`${sizes.label} font-semibold truncate max-w-full`}
          style={{ color: 'var(--color-muted)' }}>{label}</p>
      )}

      {/* Digits */}
      <div className="flex items-end gap-1"
        style={{ animation: pulse ? 'cd-pulse 1.5s ease-in-out infinite' : 'none' }}>

        {/* Days */}
        <div className="flex flex-col items-center">
          <span className={`${sizes.digit} font-bold font-mono leading-none`} style={{ color }}>{pad(days)}</span>
          <span className={`${sizes.unit} font-mono`} style={{ color: 'var(--color-dim)' }}>gg</span>
        </div>

        <span className={`${sizes.sep} font-mono leading-none pb-2`} style={{ color: `${color}88` }}>:</span>

        {/* Hours */}
        <div className="flex flex-col items-center">
          <span className={`${sizes.digit} font-bold font-mono leading-none`} style={{ color }}>{pad(hours)}</span>
          <span className={`${sizes.unit} font-mono`} style={{ color: 'var(--color-dim)' }}>hh</span>
        </div>

        <span className={`${sizes.sep} font-mono leading-none pb-2`} style={{ color: `${color}88` }}>:</span>

        {/* Minutes */}
        <div className="flex flex-col items-center">
          <span className={`${sizes.digit} font-bold font-mono leading-none`} style={{ color }}>{pad(minutes)}</span>
          <span className={`${sizes.unit} font-mono`} style={{ color: 'var(--color-dim)' }}>mm</span>
        </div>

        {showSeconds && (
          <>
            <span className={`${sizes.sep} font-mono leading-none pb-2`} style={{ color: `${color}88` }}>:</span>
            <div className="flex flex-col items-center">
              <span className={`${sizes.digit} font-bold font-mono leading-none`} style={{ color }}>{pad(seconds)}</span>
              <span className={`${sizes.unit} font-mono`} style={{ color: 'var(--color-dim)' }}>ss</span>
            </div>
          </>
        )}
      </div>

      {/* Status badge */}
      {showLabel && (
        <span className={`${sizes.unit} font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full`}
          style={{ background: `${color}18`, color, border: `1px solid ${color}33` }}>
          {status}
        </span>
      )}

      <style>{`
        @keyframes cd-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.55; }
        }
      `}</style>
    </div>
  )
}

// ── CountdownBadge — variante inline compatta ──────────────────────────────

export function CountdownBadge({ target, className }: { target: string | Date; className?: string }) {
  const targetDate  = target instanceof Date ? target : new Date(target)
  const [ms, setMs] = useState(() => remaining(targetDate))

  useEffect(() => {
    if (ms === 0) return
    const id = setInterval(() => { const r = remaining(targetDate); setMs(r); if (r === 0) clearInterval(id) }, 60000)
    return () => clearInterval(id)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const { days, hours, minutes } = fmt(ms)
  const color = urgencyColor(ms)
  const pulse = ms > 0 && ms < 86400000
  const text  = ms === 0 ? 'Scaduto' : days > 0 ? `${days}g ${pad(hours)}h` : `${pad(hours)}:${pad(minutes)}`

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold ${className ?? ''}`}
      style={{ background: `${color}18`, color, border: `1px solid ${color}33`, animation: pulse ? 'cd-pulse 1.5s ease-in-out infinite' : 'none' }}>
      ⏱ {text}
    </span>
  )
}
