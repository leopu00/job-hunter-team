'use client'

import { useEffect, useRef, useState } from 'react'

export interface DateRange { start: Date | null; end: Date | null }

export interface DateRangePickerProps {
  value: DateRange
  onChange: (r: DateRange) => void
  placeholder?: string
}

const DAYS   = ['Lu','Ma','Me','Gi','Ve','Sa','Do']
const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '7 giorni',    days: 7  },
  { label: '30 giorni',   days: 30 },
  { label: '90 giorni',   days: 90 },
  { label: '6 mesi',      days: 180 },
  { label: 'Anno',        days: 365 },
]

function fmt(d: Date): string {
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })
}

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString() }
function inRange(d: Date, s: Date, e: Date) { return d >= s && d <= e }

function CalendarMonth({
  year, month, start, end, hover, onSelect, onHover,
}: { year: number; month: number; start: Date|null; end: Date|null; hover: Date|null; onSelect: (d:Date)=>void; onHover: (d:Date|null)=>void }) {
  const first = new Date(year, month, 1)
  const dow   = (first.getDay() + 6) % 7 // Mon=0
  const days  = new Date(year, month + 1, 0).getDate()
  const cells = Array.from({ length: dow + days }, (_, i) => i < dow ? null : new Date(year, month, i - dow + 1))

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => <span key={d} className="text-center text-[8px] font-bold" style={{ color: 'var(--color-dim)' }}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => {
          if (!day) return <span key={i} />
          const isStart  = !!(start && sameDay(day, start))
          const isEnd    = !!(end && sameDay(day, end))
          const rangeEnd = end ?? hover
          const inR      = !!(start && rangeEnd && !isStart && !sameDay(day, rangeEnd) && inRange(day, start, rangeEnd))
          const isHov    = !!(hover && sameDay(day, hover))
          const today    = sameDay(day, new Date())

          return (
            <button key={i}
              onClick={() => onSelect(startOfDay(day))}
              onMouseEnter={() => onHover(day)}
              onMouseLeave={() => onHover(null)}
              className="text-[10px] py-1 rounded cursor-pointer transition-colors text-center"
              style={{
                background: isStart || isEnd ? 'var(--color-green)' : inR ? 'rgba(0,232,122,0.15)' : isHov ? 'var(--color-row)' : 'transparent',
                color: isStart || isEnd ? '#000' : today ? 'var(--color-green)' : 'var(--color-muted)',
                fontWeight: isStart || isEnd || today ? 700 : 400,
                border: 'none',
              }}>
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function DateRangePicker({ value, onChange, placeholder = 'Seleziona periodo' }: DateRangePickerProps) {
  const [open, setOpen]     = useState(false)
  const [phase, setPhase]   = useState<'start'|'end'>('start')
  const [hover, setHover]   = useState<Date|null>(null)
  const [viewYear, setVY]   = useState(new Date().getFullYear())
  const [viewMonth, setVM]  = useState(new Date().getMonth())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const applyPreset = (days: number) => {
    const end   = startOfDay(new Date())
    const start = new Date(end); start.setDate(start.getDate() - days + 1)
    onChange({ start, end }); setPhase('start'); setOpen(false)
  }

  const selectDay = (d: Date) => {
    if (phase === 'start' || !value.start) {
      onChange({ start: d, end: null }); setPhase('end')
    } else {
      const [s, e] = d < value.start ? [d, value.start] : [value.start, d]
      onChange({ start: s, end: e }); setPhase('start'); setOpen(false)
    }
  }

  const label = value.start
    ? value.end ? `${fmt(value.start)} – ${fmt(value.end)}` : `Da ${fmt(value.start)}…`
    : placeholder

  const prevMonth = () => { if (viewMonth === 0) { setVM(11); setVY(y => y-1) } else setVM(m => m-1) }
  const nextMonth = () => { if (viewMonth === 11) { setVM(0); setVY(y => y+1) } else setVM(m => m+1) }

  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] cursor-pointer transition-all"
        style={{ background: 'var(--color-panel)', border: `1px solid ${open ? 'var(--color-green)' : 'var(--color-border)'}`, color: value.start ? 'var(--color-bright)' : 'var(--color-dim)' }}>
        <span>📅</span>
        <span>{label}</span>
        {value.start && (
          <span onClick={e => { e.stopPropagation(); onChange({ start: null, end: null }); setPhase('start') }}
            className="text-[10px] cursor-pointer hover:text-red-400 transition-colors" style={{ color: 'var(--color-dim)' }}>×</span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 rounded-lg border p-3 flex gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', minWidth: 280, left: 0 }}>
          {/* Preset */}
          <div className="flex flex-col gap-1 border-r pr-3" style={{ borderColor: 'var(--color-border)' }}>
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => applyPreset(p.days)}
                className="px-3 py-1.5 rounded text-[10px] text-left cursor-pointer whitespace-nowrap transition-colors"
                style={{ background: 'transparent', border: 'none', color: 'var(--color-dim)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-green)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Calendar */}
          <div style={{ minWidth: 196 }}>
            <div className="flex items-center justify-between mb-2">
              <button aria-label="Mese precedente" onClick={prevMonth} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:14 }}>‹</button>
              <span className="text-[10px] font-semibold" style={{ color: 'var(--color-bright)' }}>{MONTHS[viewMonth]} {viewYear}</span>
              <button aria-label="Mese successivo" onClick={nextMonth} style={{ background:'none', border:'none', color:'var(--color-muted)', cursor:'pointer', fontSize:14 }}>›</button>
            </div>
            <CalendarMonth year={viewYear} month={viewMonth} start={value.start} end={value.end} hover={hover}
              onSelect={selectDay} onHover={setHover} />
            <p className="text-[8px] text-center mt-2" style={{ color: 'var(--color-dim)' }}>
              {phase === 'start' ? 'Seleziona data inizio' : 'Seleziona data fine'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
