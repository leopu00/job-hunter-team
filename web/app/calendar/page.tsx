'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type CalEvent = { id: string; title: string; type: string; date: number; company: string; details: string }

const TYPE_CLR: Record<string, string> = { interview: 'var(--color-green)', deadline: 'var(--color-red)', 'follow-up': 'var(--color-yellow)' }
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

function getMonthGrid(year: number, month: number): Array<{ day: number; inMonth: boolean }> {
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells: Array<{ day: number; inMonth: boolean }> = [];
  for (let i = startDay - 1; i >= 0; i--) cells.push({ day: prevDays - i, inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, inMonth: true });
  while (cells.length < 42) cells.push({ day: cells.length - startDay - daysInMonth + 1, inMonth: false });
  return cells;
}

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/calendar?month=${monthStr}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setEvents(data.events ?? []);
  }, [monthStr])

  useEffect(() => { fetchData() }, [fetchData])

  const prev = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); setSelectedDay(null); }
  const next = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); setSelectedDay(null); }

  const grid = getMonthGrid(year, month);
  const eventsByDay: Record<number, CalEvent[]> = {};
  for (const e of events) { const d = new Date(e.date).getDate(); (eventsByDay[d] ??= []).push(e); }
  const today = now.getFullYear() === year && now.getMonth() === month ? now.getDate() : -1;
  const dayEvents = selectedDay ? (eventsByDay[selectedDay] ?? []) : [];

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-6 pb-4 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Calendario</span>
        </nav>
        <div className="flex items-center justify-between mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Calendario</h1>
          <div className="flex items-center gap-3">
            <button onClick={prev} className="px-2 py-1 rounded text-[12px] cursor-pointer" style={{ color: 'var(--color-muted)', background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>&larr;</button>
            <span className="text-[12px] font-semibold text-[var(--color-bright)] w-36 text-center">{MONTHS[month]} {year}</span>
            <button onClick={next} className="px-2 py-1 rounded text-[12px] cursor-pointer" style={{ color: 'var(--color-muted)', background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>&rarr;</button>
          </div>
          <p className="text-[var(--color-muted)] text-[11px]">{events.length} eventi</p>
        </div>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="grid grid-cols-7">
          {DAYS.map(d => <div key={d} className="text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-center py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>{d}</div>)}
          {grid.map((cell, i) => {
            const evts = cell.inMonth ? (eventsByDay[cell.day] ?? []) : [];
            const isToday = cell.inMonth && cell.day === today;
            const isSelected = cell.inMonth && cell.day === selectedDay;
            return (
              <div key={i} role="button" tabIndex={cell.inMonth ? 0 : -1} onClick={() => cell.inMonth && setSelectedDay(cell.day === selectedDay ? null : cell.day)}
                onKeyDown={e => { if (cell.inMonth && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelectedDay(cell.day === selectedDay ? null : cell.day); } }}
                className="min-h-[60px] p-1 border-b border-r border-[var(--color-border)] cursor-pointer transition-colors"
                style={{ background: isSelected ? 'rgba(0,232,122,0.06)' : 'transparent', opacity: cell.inMonth ? 1 : 0.3 }}>
                <span className="text-[10px] font-mono" style={{ color: isToday ? 'var(--color-green)' : 'var(--color-dim)', fontWeight: isToday ? 700 : 400 }}>{cell.day}</span>
                {evts.slice(0, 2).map(e => (
                  <div key={e.id} className="text-[7px] truncate mt-0.5 px-1 rounded" style={{ color: TYPE_CLR[e.type] ?? 'var(--color-dim)', background: `${TYPE_CLR[e.type] ?? 'var(--color-dim)'}15` }}>{e.title.slice(0, 20)}</div>
                ))}
                {evts.length > 2 && <span className="text-[7px] text-[var(--color-dim)]">+{evts.length - 2}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {selectedDay && (
        <div className="mt-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] p-4">
          <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">{selectedDay} {MONTHS[month]}</p>
          {dayEvents.length === 0 ? <p className="text-[10px] text-[var(--color-dim)]">Nessun evento per questo giorno.</p>
            : dayEvents.map(e => (
              <div key={e.id} className="flex items-center gap-3 py-2 border-b border-[var(--color-border)] last:border-0">
                <span className="w-2 h-2 rounded-full" style={{ background: TYPE_CLR[e.type] ?? 'var(--color-dim)' }} />
                <span className="text-[10px] text-[var(--color-bright)] font-medium flex-1">{e.title}</span>
                <span className="text-[9px] text-[var(--color-dim)]">{e.company}</span>
                <span className="text-[9px] text-[var(--color-dim)]">{e.details}</span>
                <span className="text-[9px] font-mono text-[var(--color-dim)]">{new Date(e.date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
