'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type ServiceInfo = { name: string; label: string; running: boolean; pid: number | null; status: string; uptimeMs: number | null; recentLogs: string[] }
type DaemonData = { platform: string; services: ServiceInfo[]; anyRunning: boolean; ts: number }

function fmtUptime(ms: number | null) {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function ServiceCard({ svc, onAction }: { svc: ServiceInfo; onAction: (name: string, action: 'start' | 'stop' | 'restart') => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const act = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true)
    await onAction(svc.name, action)
    setBusy(false)
  }
  const statusColor = svc.running ? 'var(--color-green)' : svc.status === 'loaded' ? 'var(--color-yellow)' : 'var(--color-dim)'
  return (
    <div className="border rounded-lg overflow-hidden transition-colors duration-200"
      style={{ borderColor: svc.running ? 'rgba(0,232,122,0.25)' : 'var(--color-border)', background: 'var(--color-panel)' }}
      onMouseEnter={e => { if (!svc.running) e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
      onMouseLeave={e => { if (!svc.running) e.currentTarget.style.borderColor = 'var(--color-border)' }}>
      <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span style={{ color: statusColor, animation: svc.running ? 'pulse-dot 2.5s ease-in-out infinite' : undefined }}>●</span>
        <div className="flex-1">
          <p className="text-[13px] font-bold text-[var(--color-white)]">{svc.name}</p>
          <p className="text-[9px] font-mono text-[var(--color-dim)]">{svc.label}</p>
        </div>
        <span className="badge text-[9px]" style={{ color: statusColor, border: `1px solid ${statusColor}44`, background: `${statusColor}0d` }}>{svc.status}</span>
      </div>
      <div className="px-5 py-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div><span className="text-[var(--color-dim)]">PID</span><br /><span className="font-mono text-[var(--color-bright)]">{svc.pid ?? '—'}</span></div>
          <div><span className="text-[var(--color-dim)]">Uptime</span><br /><span className="font-mono text-[var(--color-bright)]">{fmtUptime(svc.uptimeMs)}</span></div>
        </div>
        <div className="flex gap-2">
          {!svc.running
            ? <button disabled={busy} onClick={() => act('start')} className="flex-1 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-colors" style={{ background: 'rgba(0,232,122,0.1)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.25)' }}>▶ avvia</button>
            : <>
                <button disabled={busy} onClick={() => act('restart')} className="flex-1 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-colors" style={{ background: 'rgba(77,159,255,0.08)', color: 'var(--color-blue)', border: '1px solid rgba(77,159,255,0.2)' }}>↺ restart</button>
                <button disabled={busy} onClick={() => act('stop')} className="flex-1 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-colors" style={{ background: 'rgba(255,69,96,0.08)', color: 'var(--color-red)', border: '1px solid rgba(255,69,96,0.2)' }}>■ stop</button>
              </>
          }
        </div>
        {svc.recentLogs.length > 0 && (
          <div>
            <p className="text-[9px] text-[var(--color-dim)] mb-1">Log recenti</p>
            <pre className="text-[9px] font-mono text-[var(--color-dim)] bg-[var(--color-card)] rounded px-3 py-2 overflow-x-auto max-h-28 overflow-y-auto border border-[var(--color-border)] whitespace-pre-wrap">
              {svc.recentLogs.slice(-6).join('\n')}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DaemonPage() {
  const [data, setData] = useState<DaemonData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/daemon').catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const id = setInterval(fetchData, 10_000); return () => clearInterval(id) }, [fetchData])

  const handleAction = useCallback(async (service: string, action: 'start' | 'stop' | 'restart') => {
    await fetch('/api/daemon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service, action }) }).catch(() => null)
    await fetchData()
  }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Daemon</span>
        </nav>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Daemon</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {data ? `${data.services.filter(s => s.running).length}/${data.services.length} in esecuzione · ${data.platform}` : 'Caricamento…'}
            </p>
          </div>
          <button onClick={fetchData} className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-all"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-green)'; e.currentTarget.style.color = 'var(--color-green)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-muted)' }}>
            ↻ aggiorna
          </button>
        </div>
      </div>
      {loading && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Caricamento daemon…</span></div>}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.services.map(s => <ServiceCard key={s.name} svc={s} onAction={handleAction} />)}
        </div>
      )}
    </div>
  )
}
