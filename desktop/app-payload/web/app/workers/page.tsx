'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Worker = { name: string; session: string; branch: string; currentTask: string | null; lastCommit: string | null; status: 'active' | 'idle' | 'offline' }

const STATUS_CFG: Record<string, { color: string; bg: string; label: string }> = {
  active:  { color: 'var(--color-green)',  bg: 'rgba(0,200,83,0.08)',   label: 'attivo' },
  idle:    { color: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.08)', label: 'idle' },
  offline: { color: 'var(--color-dim)',    bg: 'transparent',           label: 'offline' },
}

function WorkerRow({ w }: { w: Worker }) {
  const cfg = STATUS_CFG[w.status]
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
      style={{ opacity: w.status === 'offline' ? 0.5 : 1 }}>
      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: cfg.color }} />
      <div className="w-16 flex-shrink-0">
        <span className="text-[12px] font-bold text-[var(--color-bright)]">{w.name}</span>
      </div>
      <div className="w-36 flex-shrink-0">
        <span className="text-[10px] font-mono text-[var(--color-muted)]">{w.session}</span>
      </div>
      <div className="w-24 flex-shrink-0">
        <span className="text-[10px] font-mono text-[var(--color-dim)]">{w.branch}</span>
      </div>
      <div className="flex-1 min-w-0">
        {w.currentTask
          ? <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: 'var(--color-green)', background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.2)' }}>{w.currentTask}</span>
          : <span className="text-[10px] text-[var(--color-dim)]">-</span>
        }
      </div>
      <div className="w-48 flex-shrink-0 truncate">
        <span className="text-[9px] font-mono text-[var(--color-dim)]">{w.lastCommit || '-'}</span>
      </div>
      <span className="badge text-[9px] flex-shrink-0" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}40` }}>{cfg.label}</span>
    </div>
  )
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [onlineCount, setOnlineCount] = useState(0)
  const [filter, setFilter] = useState('all')

  const fetchWorkers = useCallback(async () => {
    const res = await fetch('/api/workers').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setWorkers(data.workers ?? [])
    setActiveCount(data.activeCount ?? 0)
    setOnlineCount(data.onlineCount ?? 0)
  }, [])

  useEffect(() => { fetchWorkers() }, [fetchWorkers])
  useEffect(() => { const id = setInterval(fetchWorkers, 5000); return () => clearInterval(id) }, [fetchWorkers])

  const filtered = filter === 'all' ? workers : workers.filter(w => w.status === filter)
  const FILTERS = ['all', 'active', 'idle', 'offline']

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Workers</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Workers</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{activeCount} attivi · {onlineCount} online · {workers.length} totali</p>
      </div>

      <div className="flex gap-1 mb-4">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
            style={{ background: filter === f ? 'var(--color-row)' : 'transparent', color: filter === f ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {f}
          </button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-4 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="w-2" />
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">NOME</span>
          <span className="w-36 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">SESSIONE</span>
          <span className="w-24 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">BRANCH</span>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">TASK</span>
          <span className="w-48 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">ULTIMO COMMIT</span>
          <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">STATO</span>
        </div>
        {filtered.length === 0
          ? <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun worker trovato.</p></div>
          : filtered.map(w => <WorkerRow key={w.session} w={w} />)
        }
      </div>
    </div>
  )
}
