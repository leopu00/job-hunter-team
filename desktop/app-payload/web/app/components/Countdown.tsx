'use client'

import { useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface CountdownProps {
  targetDate:   string          // ISO string
  onComplete?:  () => void
  showDays?:    boolean
  showHours?:   boolean
  showMinutes?: boolean
  showSeconds?: boolean
  format?:      'compact' | 'full'
  className?:   string
}

interface TimeLeft { days: number; hours: number; minutes: number; seconds: number }

// ── Helpers ────────────────────────────────────────────────────────────────

function calcTimeLeft(target: Date): TimeLeft {
  const diff = Math.max(0, target.getTime() - Date.now())
  return {
    days:    Math.floor(diff / 86_400_000),
    hours:   Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000)  / 60_000),
    seconds: Math.floor((diff % 60_000)     / 1_000),
  }
}

function urgencyColor(days: number, hours: number): string {
  const totalH = days * 24 + hours
  if (totalH < 24)  return 'var(--color-red)'
  if (days   < 7)   return 'var(--color-orange)'
  return 'var(--color-green)'
}

// ── FlipDigit ──────────────────────────────────────────────────────────────

const FLIP_STYLE = `
@keyframes flip-top { 0%{transform:rotateX(0deg)}100%{transform:rotateX(-90deg)} }
@keyframes flip-bot { 0%{transform:rotateX(90deg)}100%{transform:rotateX(0deg)} }
`

function FlipDigit({ value, color }: { value: string; color: string }) {
  const [prev, setPrev] = useState(value)
  const [flipping, setFlipping] = useState(false)
  const next = useRef(value)

  useEffect(() => {
    if (value === prev) return
    next.current = value
    setFlipping(true)
    const t = setTimeout(() => { setPrev(value); setFlipping(false) }, 300)
    return () => clearTimeout(t)
  }, [value, prev])

  const cell = (content: string, anim?: string) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '100%', height: '50%', overflow: 'hidden', backfaceVisibility: 'hidden',
      animation: anim ? `${anim} 0.15s ease-in forwards` : undefined }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'inherit', color, fontWeight: 700, lineHeight: 1 }}>
        {content}
      </span>
    </div>
  )

  return (
    <div style={{ position: 'relative', width: '1.8em', height: '2.4em',
      background: 'var(--color-row)', border: '1px solid var(--color-border)', borderRadius: 4,
      display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top half */}
      <div style={{ position: 'absolute', top: 0, width: '100%', height: '50%',
        borderBottom: '1px solid var(--color-border)', zIndex: 2 }}>
        {cell(flipping ? prev : value, flipping ? 'flip-top' : undefined)}
      </div>
      {/* Bottom half */}
      <div style={{ position: 'absolute', bottom: 0, width: '100%', height: '50%', zIndex: flipping ? 3 : 1 }}>
        {cell(flipping ? next.current : value, flipping ? 'flip-bot' : undefined)}
      </div>
    </div>
  )
}

// ── Unit block ─────────────────────────────────────────────────────────────

function Unit({ n, label, color, compact }: { n: number; label: string; color: string; compact: boolean }) {
  const s = String(n).padStart(2, '0')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ display: 'flex', gap: 2, fontSize: compact ? 18 : 28 }}>
        <FlipDigit value={s[0]} color={color} />
        <FlipDigit value={s[1]} color={color} />
      </div>
      {!compact && (
        <span style={{ fontSize: 8, color: 'var(--color-dim)', fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {label}
        </span>
      )}
    </div>
  )
}

const SEP = ({ color }: { color: string }) => (
  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color, alignSelf: 'flex-start',
    paddingTop: 2, fontSize: 20, lineHeight: 1 }}>:</span>
)

// ── Countdown ──────────────────────────────────────────────────────────────

export function Countdown({
  targetDate, onComplete, className = '',
  showDays = true, showHours = true, showMinutes = true, showSeconds = true,
  format = 'full',
}: CountdownProps) {
  const target   = new Date(targetDate)
  const [t, setT] = useState<TimeLeft>(() => calcTimeLeft(target))
  const done      = useRef(false)
  const compact   = format === 'compact'
  const color     = urgencyColor(t.days, t.hours)

  useEffect(() => {
    const id = setInterval(() => {
      const next = calcTimeLeft(target)
      setT(next)
      if (!done.current && next.days === 0 && next.hours === 0 && next.minutes === 0 && next.seconds === 0) {
        done.current = true
        onComplete?.()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [targetDate]) // eslint-disable-line

  const units: { n: number; label: string; show: boolean }[] = [
    { n: t.days,    label: 'giorni',   show: showDays    },
    { n: t.hours,   label: 'ore',      show: showHours   },
    { n: t.minutes, label: 'minuti',   show: showMinutes },
    { n: t.seconds, label: 'secondi',  show: showSeconds },
  ]
  const visible = units.filter(u => u.show)

  return (
    <>
      <style>{FLIP_STYLE}</style>
      <div role="timer" aria-label="Conto alla rovescia" className={`inline-flex items-center gap-2 ${className}`}>
        {visible.map((u, i) => (
          <div key={u.label} className="flex items-center gap-2">
            <Unit n={u.n} label={u.label} color={color} compact={compact} />
            {i < visible.length - 1 && <SEP color={color} />}
          </div>
        ))}
      </div>
    </>
  )
}
