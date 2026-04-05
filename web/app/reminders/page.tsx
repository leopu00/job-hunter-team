'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Reminder = { id: string; type: string; title: string; jobTitle?: string; company?: string; dueDate: number; status: 'pending' | 'done' | 'snoozed'; note?: string }
type Summary = { total: number; pending: number; overdue: number; done: number }

const TYPE_CFG: Record<string, { label: string; color: string }> = {
  'follow-up': { label: 'Follow-up', color: '#61affe' },
  'interview-prep': { label: 'Prep colloquio', color: '#fca130' },
  'offer-deadline': { label: 'Scadenza offerta', color: 'var(--color-red)' },
  'custom': { label: 'Promemoria', color: 'var(--color-muted)' },
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Da fare', color: 'var(--color-green)' },
  done: { label: 'Fatto', color: 'var(--color-dim)' },
  snoozed: { label: 'Rinviato', color: '#fca130' },
}

function timeLabel(ts: number): string {
  const diff = ts - Date.now(), d = Math.ceil(diff / 86400000);
  if (d < -1) return `${Math.abs(d)}g fa`;
  if (d === -1) return 'Ieri';
  if (d === 0) return 'Oggi';
  if (d === 1) return 'Domani';
  return `tra ${d}g`;
}

function ReminderRow({ rem, onStatus }: { rem: Reminder; onStatus: (id: string, status: string) => void }) {
  const type = TYPE_CFG[rem.type] ?? TYPE_CFG.custom;
  const stat = STATUS_CFG[rem.status] ?? STATUS_CFG.pending;
  const overdue = rem.status === 'pending' && rem.dueDate < Date.now();
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors" style={{ opacity: rem.status === 'done' ? 0.5 : 1 }}>
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: overdue ? 'var(--color-red)' : type.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-[var(--color-bright)] font-medium truncate" style={{ textDecoration: rem.status === 'done' ? 'line-through' : 'none' }}>{rem.title}</p>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: type.color, color: '#000' }}>{type.label}</span>
        </div>
        {(rem.jobTitle || rem.company) && <p className="text-[9px] text-[var(--color-dim)] truncate">{rem.jobTitle}{rem.company ? ` · ${rem.company}` : ''}</p>}
        {rem.note && <p className="text-[9px] text-[var(--color-dim)] italic mt-0.5">{rem.note}</p>}
      </div>
      <span className="text-[9px] font-mono w-16 text-right" style={{ color: overdue ? 'var(--color-red)' : 'var(--color-dim)' }}>{timeLabel(rem.dueDate)}</span>
      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded w-16 text-center" style={{ color: stat.color, border: `1px solid ${stat.color}` }}>{stat.label}</span>
      <div className="flex gap-1">
        {rem.status !== 'done' && <button onClick={() => onStatus(rem.id, 'done')} className="text-[8px] px-1.5 py-0.5 rounded cursor-pointer font-bold" style={{ color: 'var(--color-green)', border: '1px solid var(--color-border)' }}>✓</button>}
        {rem.status === 'pending' && <button onClick={() => onStatus(rem.id, 'snoozed')} className="text-[8px] px-1.5 py-0.5 rounded cursor-pointer font-bold" style={{ color: '#fca130', border: '1px solid var(--color-border)' }}>⏸</button>}
        {rem.status === 'snoozed' && <button onClick={() => onStatus(rem.id, 'pending')} className="text-[8px] px-1.5 py-0.5 rounded cursor-pointer font-bold" style={{ color: '#61affe', border: '1px solid var(--color-border)' }}>▶</button>}
      </div>
    </div>
  )
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, pending: 0, overdue: 0, done: 0 })
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ type: 'custom', title: '', jobTitle: '', company: '', dueDate: '', note: '' })
  const [filter, setFilter] = useState<string>('all')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/reminders').catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    setReminders(d.reminders ?? []); setSummary(d.summary ?? {})
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const updateStatus = async (id: string, status: string) => {
    await fetch('/api/reminders', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) }).catch(() => null)
    fetchData()
  }

  const add = async () => {
    if (!form.title.trim() || !form.dueDate) return
    await fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).catch(() => null)
    setForm({ type: 'custom', title: '', jobTitle: '', company: '', dueDate: '', note: '' }); setAdding(false); fetchData()
  }

  const filtered = filter === 'all' ? reminders : reminders.filter(r => r.status === filter)
  const inputStyle = { background: 'var(--color-deep)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' } as const

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Promemoria</span>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Promemoria</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{summary.pending} da fare · {summary.overdue > 0 ? <span style={{ color: 'var(--color-red)' }}>{summary.overdue} scaduti</span> : '0 scaduti'} · {summary.done} completati</p>
          </div>
          <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>{adding ? 'Annulla' : '+ Nuovo'}</button>
        </div>
      </div>

      {adding && (
        <div className="mb-4 p-4 rounded-lg flex gap-2 items-end flex-wrap" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
          <div className="flex flex-col gap-0.5 w-28"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">TIPO</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} aria-label="Tipo promemoria" className="text-[10px] px-2 py-1.5 rounded" style={inputStyle}>
              <option value="follow-up">Follow-up</option><option value="interview-prep">Prep colloquio</option><option value="offer-deadline">Scadenza offerta</option><option value="custom">Altro</option>
            </select></div>
          <div className="flex flex-col gap-0.5 flex-1"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">TITOLO</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="text-[10px] px-2 py-1.5 rounded" style={inputStyle} /></div>
          <div className="flex flex-col gap-0.5 w-28"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">SCADENZA</label>
            <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className="text-[10px] px-2 py-1.5 rounded" style={inputStyle} /></div>
          <button onClick={add} disabled={!form.title.trim() || !form.dueDate} className="px-3 py-1.5 rounded text-[10px] font-bold"
            style={{ background: form.title.trim() && form.dueDate ? 'var(--color-green)' : 'var(--color-border)', color: form.title.trim() && form.dueDate ? '#000' : 'var(--color-dim)', cursor: form.title.trim() && form.dueDate ? 'pointer' : 'default' }}>Crea</button>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {[['all', 'Tutti'], ['pending', 'Da fare'], ['done', 'Fatti'], ['snoozed', 'Rinviati']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className="px-3 py-1 rounded text-[9px] font-bold cursor-pointer"
            style={{ background: filter === k ? 'var(--color-green)' : 'var(--color-row)', color: filter === k ? '#000' : 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{l}</button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {filtered.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun promemoria.</p></div>
          : filtered.map(r => <ReminderRow key={r.id} rem={r} onStatus={updateStatus} />)}
      </div>
    </div>
  )
}
