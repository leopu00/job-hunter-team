'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Goal = { id: string; title: string; target: number; current: number; unit: string; deadline: string; status: 'on-track' | 'behind' | 'completed'; createdAt: number }
type Summary = { total: number; completed: number; onTrack: number; behind: number }

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  'on-track': { label: 'In pista', color: 'var(--color-green)' },
  'behind': { label: 'In ritardo', color: 'var(--color-red)' },
  'completed': { label: 'Completato', color: '#61affe' },
}

function daysLeft(deadline: string): string {
  const d = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
  if (d < 0) return `${Math.abs(d)}g scaduto`;
  if (d === 0) return 'Oggi';
  return `${d}g rimasti`;
}

function GoalRow({ goal, onUpdate }: { goal: Goal; onUpdate: (id: string, current: number) => void }) {
  const pct = Math.min(Math.round(goal.current / goal.target * 100), 100);
  const cfg = STATUS_CFG[goal.status] ?? STATUS_CFG['on-track'];
  return (
    <div className="px-5 py-4 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-[var(--color-bright)] font-medium">{goal.title}</p>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: cfg.color, color: '#000' }}>{cfg.label}</span>
        </div>
        <span className="text-[9px] text-[var(--color-dim)]">{daysLeft(goal.deadline)}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-deep)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cfg.color }} />
        </div>
        <span className="text-[9px] text-[var(--color-muted)] font-mono w-20 text-right">{goal.current}/{goal.target} {goal.unit}</span>
        <span className="text-[10px] font-bold text-[var(--color-white)] w-10 text-right">{pct}%</span>
      </div>
      {goal.status !== 'completed' && (
        <div className="flex gap-1 mt-2">
          <button onClick={() => onUpdate(goal.id, goal.current + 1)} aria-label="Incrementa progresso" className="text-[9px] px-3 py-1.5 rounded cursor-pointer font-bold"
            style={{ background: 'var(--color-row)', color: 'var(--color-green)', border: '1px solid var(--color-border)' }}>+1</button>
          {goal.current > 0 && <button onClick={() => onUpdate(goal.id, goal.current - 1)} aria-label="Decrementa progresso" className="text-[9px] px-3 py-1.5 rounded cursor-pointer font-bold"
            style={{ background: 'var(--color-row)', color: 'var(--color-red)', border: '1px solid var(--color-border)' }}>-1</button>}
        </div>
      )}
    </div>
  )
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, completed: 0, onTrack: 0, behind: 0 })
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', target: '', unit: '', deadline: '' })

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/goals').catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    setGoals(d.goals ?? []); setSummary(d.summary ?? {})
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const update = async (id: string, current: number) => {
    await fetch('/api/goals', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, current }) }).catch(() => null)
    fetchData()
  }

  const add = async () => {
    if (!form.title.trim() || !form.target || !form.deadline) return
    await fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.title, target: Number(form.target), unit: form.unit || 'unità', deadline: form.deadline }) }).catch(() => null)
    setForm({ title: '', target: '', unit: '', deadline: '' }); setAdding(false); fetchData()
  }

  const inputStyle = { background: 'var(--color-deep)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' } as const

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Obiettivi</span>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Obiettivi</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{summary.completed} completati · {summary.onTrack} in pista · {summary.behind} in ritardo</p>
          </div>
          <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>{adding ? 'Annulla' : '+ Nuovo'}</button>
        </div>
      </div>

      {adding && (
        <div className="mb-4 p-4 rounded-lg flex gap-2 items-end flex-wrap" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
          <div className="flex flex-col gap-0.5 flex-1"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">OBIETTIVO</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="text-[10px] px-2 py-1.5 rounded" style={inputStyle} /></div>
          <div className="flex flex-col gap-0.5 w-20"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">TARGET</label>
            <input type="number" value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} className="text-[10px] px-2 py-1.5 rounded" style={inputStyle} /></div>
          <div className="flex flex-col gap-0.5 w-24"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">UNITÀ</label>
            <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="es. candidature" className="text-[10px] px-2 py-1.5 rounded" style={inputStyle} /></div>
          <div className="flex flex-col gap-0.5 w-32"><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">DEADLINE</label>
            <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className="text-[10px] px-2 py-1.5 rounded" style={inputStyle} /></div>
          <button onClick={add} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>Crea</button>
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {goals.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun obiettivo impostato.</p></div>
          : goals.map(g => <GoalRow key={g.id} goal={g} onUpdate={update} />)}
      </div>
    </div>
  )
}
