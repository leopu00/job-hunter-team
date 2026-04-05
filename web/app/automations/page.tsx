'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Automation = { id: string; name: string; trigger: string; triggerConfig: string; action: string; actionTarget: string; enabled: boolean; lastRun: number | null; nextRun: number | null; runCount: number }

const TRIGGER_CLR: Record<string, { color: string; label: string }> = {
  cron: { color: '#61affe', label: 'cron' }, event: { color: '#fca130', label: 'event' }, webhook: { color: '#49cc90', label: 'webhook' },
}
const ACTION_CLR: Record<string, { color: string }> = {
  notify: { color: 'var(--color-yellow)' }, deploy: { color: 'var(--color-red)' }, backup: { color: 'var(--color-green)' }, script: { color: '#61affe' }, sync: { color: '#50e3c2' },
}

function timeAgo(ts: number | null): string {
  if (!ts) return '—';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 0) return timeUntil(ts);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}
function timeUntil(ts: number | null): string {
  if (!ts) return '—';
  const m = Math.floor((ts - Date.now()) / 60000);
  if (m < 0) return 'scaduto';
  if (m < 60) return `tra ${m}m`; if (m < 1440) return `tra ${Math.floor(m / 60)}h`; return `tra ${Math.floor(m / 1440)}g`;
}

function AutoRow({ a, onToggle }: { a: Automation; onToggle: (id: string, enabled: boolean) => void }) {
  const trig = TRIGGER_CLR[a.trigger] ?? { color: 'var(--color-dim)', label: a.trigger };
  const act = ACTION_CLR[a.action] ?? { color: 'var(--color-dim)' };
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.enabled ? 'var(--color-green)' : 'var(--color-dim)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[var(--color-bright)] truncate">{a.name}</p>
        <p className="text-[9px] text-[var(--color-dim)] font-mono">{a.triggerConfig} → {a.actionTarget}</p>
      </div>
      <span className="badge text-[8px] px-2 py-0.5 rounded" style={{ color: trig.color, border: `1px solid ${trig.color}40` }}>{trig.label}</span>
      <span className="badge text-[8px] px-2 py-0.5 rounded" style={{ color: act.color, border: `1px solid ${act.color}40` }}>{a.action}</span>
      <span className="text-[9px] font-mono text-[var(--color-dim)] w-14 text-right">{a.runCount}x</span>
      <span className="text-[9px] text-[var(--color-dim)] w-16 text-right">{timeAgo(a.lastRun)}</span>
      <span className="text-[9px] w-16 text-right" style={{ color: a.nextRun ? 'var(--color-muted)' : 'var(--color-dim)' }}>{timeUntil(a.nextRun)}</span>
      <button onClick={() => onToggle(a.id, !a.enabled)} aria-label={`${a.enabled ? 'Disattiva' : 'Attiva'} ${a.name}`} className="text-[9px] font-bold cursor-pointer w-8"
        style={{ color: a.enabled ? 'var(--color-green)' : 'var(--color-dim)' }}>{a.enabled ? 'ON' : 'OFF'}</button>
    </div>
  )
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [enabled, setEnabled] = useState(0)
  const [total, setTotal] = useState(0)
  const [trigFilter, setTrigFilter] = useState('all')
  const [actFilter, setActFilter] = useState('all')
  const [triggers, setTriggers] = useState<string[]>([])
  const [actions, setActions] = useState<string[]>([])

  const fetchData = useCallback(async () => {
    const params = new URLSearchParams();
    if (trigFilter !== 'all') params.set('trigger', trigFilter);
    if (actFilter !== 'all') params.set('action', actFilter);
    const q = params.toString() ? `?${params}` : '';
    const res = await fetch(`/api/automations${q}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setAutomations(data.automations ?? []); setEnabled(data.enabled ?? 0); setTotal(data.total ?? 0);
    setTriggers(data.triggers ?? []); setActions(data.actions ?? []);
  }, [trigFilter, actFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const toggle = async (id: string, en: boolean) => {
    await fetch('/api/automations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled: en }) }).catch(() => null);
    fetchData();
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Automazioni</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Automazioni</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{enabled} attive · {total} totali</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={trigFilter} onChange={e => setTrigFilter(e.target.value)}
          aria-label="Filtra per trigger" className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          <option value="all">Tutti i trigger</option>
          {triggers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={actFilter} onChange={e => setActFilter(e.target.value)}
          aria-label="Filtra per azione" className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          <option value="all">Tutte le azioni</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="w-2" /><span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">AUTOMAZIONE</span>
          <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">TRIGGER</span>
          <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">AZIONE</span>
          <span className="w-14 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">RUNS</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">ULTIMO</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">PROSSIMO</span>
          <span className="w-8" />
        </div>
        {automations.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna automazione trovata.</p></div>
          : automations.map(a => <AutoRow key={a.id} a={a} onToggle={toggle} />)}
      </div>
    </div>
  )
}
