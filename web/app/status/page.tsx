'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'maintenance'
type ServiceInfo = { id: string; name: string; status: ServiceStatus; latencyMs: number; uptimePercent: number; lastCheck: number }
type Incident = { id: string; title: string; status: string; severity: string; createdAt: number; resolvedAt?: number }

const STATUS_CFG: Record<ServiceStatus, { color: string; bg: string; label: string; dot: string }> = {
  operational: { color: 'var(--color-green)', bg: 'rgba(0,200,83,0.08)', label: 'operativo', dot: '●' },
  degraded:    { color: 'var(--color-yellow)', bg: 'rgba(255,193,7,0.08)', label: 'degradato', dot: '◐' },
  down:        { color: 'var(--color-red)', bg: 'rgba(255,69,96,0.08)', label: 'offline', dot: '○' },
  maintenance: { color: 'var(--color-dim)', bg: 'transparent', label: 'manutenzione', dot: '◑' },
}

const SEV_CLR: Record<string, string> = { minor: 'var(--color-yellow)', major: 'var(--color-red)', critical: 'var(--color-red)' }

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function ServiceRow({ svc }: { svc: ServiceInfo }) {
  const cfg = STATUS_CFG[svc.status];
  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <span className="text-[14px]" style={{ color: cfg.color }}>{cfg.dot}</span>
      <span className="flex-1 text-[11px] text-[var(--color-bright)] font-medium">{svc.name}</span>
      {svc.latencyMs > 0 && <span className="text-[9px] font-mono text-[var(--color-dim)]">{svc.latencyMs}ms</span>}
      <span className="text-[9px] font-mono w-14 text-right" style={{ color: svc.uptimePercent >= 99 ? 'var(--color-green)' : svc.uptimePercent >= 90 ? 'var(--color-yellow)' : 'var(--color-red)' }}>{svc.uptimePercent}%</span>
      <span className="badge text-[9px] w-20 text-center" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}40` }}>{cfg.label}</span>
    </div>
  )
}

function IncidentRow({ inc }: { inc: Incident }) {
  const resolved = inc.status === 'resolved';
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--color-border)]">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: resolved ? 'var(--color-green)' : (SEV_CLR[inc.severity] ?? 'var(--color-red)') }} />
      <span className="flex-1 text-[10px] text-[var(--color-muted)]">{inc.title}</span>
      <span className="text-[9px] text-[var(--color-dim)]">{timeAgo(inc.createdAt)}</span>
      <span className="text-[9px] font-semibold" style={{ color: resolved ? 'var(--color-green)' : 'var(--color-yellow)' }}>{resolved ? 'risolto' : inc.status}</span>
    </div>
  )
}

export default function StatusPage() {
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [maintenance, setMaintenance] = useState<{ active: boolean; message: string }>({ active: false, message: '' })
  const [overall, setOverall] = useState<ServiceStatus>('operational')
  const [operational, setOperational] = useState(0)
  const [total, setTotal] = useState(0)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/status').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setServices(data.services ?? []); setIncidents(data.incidents ?? []); setMaintenance(data.maintenance ?? { active: false, message: '' });
    setOverall(data.overall ?? 'operational'); setOperational(data.operational ?? 0); setTotal(data.total ?? 0);
  }, [])

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 5000); return () => clearInterval(t) }, [fetchData])

  const overallCfg = STATUS_CFG[overall];

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Status</span>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Stato del Sistema</h1>
          <span className="badge text-[10px] px-3 py-1" style={{ color: overallCfg.color, background: overallCfg.bg, border: `1px solid ${overallCfg.color}40` }}>{overallCfg.dot} {overallCfg.label}</span>
        </div>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{operational}/{total} servizi operativi</p>
      </div>

      {maintenance.active && (
        <div className="mb-6 px-5 py-3 rounded-lg" style={{ background: 'rgba(255,193,7,0.08)', border: '1px solid rgba(255,193,7,0.3)' }}>
          <p className="text-[11px] font-semibold" style={{ color: 'var(--color-yellow)' }}><span aria-hidden="true">⚠</span> Manutenzione in corso</p>
          <p className="text-[10px] text-[var(--color-muted)] mt-1">{maintenance.message}</p>
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)] mb-8">
        <div className="flex items-center gap-4 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">SERVIZIO</span>
          <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">LATENZA</span>
          <span className="w-14 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">UPTIME</span>
          <span className="w-20 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-center">STATO</span>
        </div>
        {services.map(s => <ServiceRow key={s.id} svc={s} />)}
      </div>

      {incidents.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          <div className="px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
            <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">INCIDENTI RECENTI</span>
          </div>
          {incidents.map(i => <IncidentRow key={i.id} inc={i} />)}
        </div>
      )}
    </div>
  )
}
