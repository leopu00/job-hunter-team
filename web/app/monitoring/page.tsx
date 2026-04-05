'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Metrics = { cpuUsage: number; memoryUsedMB: number; memoryTotalMB: number; memoryPercent: number; uptimeSeconds: number; loadAvg: number[] }
type Agent = { agentId: string; lastSeen: number; status: 'alive' | 'stale' | 'dead'; metadata?: Record<string, unknown> }
type Alert = { thresholdId: string; metric: string; currentValue: number; thresholdValue: number; description: string; triggeredAt: number }

const STATUS_CFG: Record<string, { color: string; bg: string }> = {
  alive: { color: 'var(--color-green)', bg: 'rgba(0,200,83,0.08)' },
  stale: { color: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.08)' },
  dead:  { color: 'var(--color-red)', bg: 'rgba(255,69,96,0.08)' },
}

function MetricCard({ label, value, unit, warn }: { label: string; value: string; unit?: string; warn?: boolean }) {
  return (
    <div className="flex flex-col p-4 rounded-lg" style={{ background: 'var(--color-row)', border: `1px solid ${warn ? 'rgba(255,69,96,0.3)' : 'var(--color-border)'}` }}>
      <span className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase">{label}</span>
      <span className="text-xl font-bold font-mono mt-1" style={{ color: warn ? 'var(--color-red)' : 'var(--color-bright)' }}>{value}<span className="text-[10px] text-[var(--color-dim)] ml-1">{unit}</span></span>
    </div>
  )
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}g ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function MonitoringPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/monitoring').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setMetrics(data.metrics)
    setAgents(data.agents ?? [])
    setAlerts(data.alerts ?? [])
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const id = setInterval(fetchData, 3000); return () => clearInterval(id) }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Monitoring</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Monitoring</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Metriche sistema real-time · {agents.length} agenti · {alerts.length} alert attivi</p>
      </div>

      {metrics && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <MetricCard label="CPU" value={`${metrics.cpuUsage}`} unit="%" warn={metrics.cpuUsage > 80} />
          <MetricCard label="Memoria" value={`${metrics.memoryUsedMB}/${metrics.memoryTotalMB}`} unit="MB" warn={metrics.memoryPercent > 85} />
          <MetricCard label="Mem %" value={`${metrics.memoryPercent}`} unit="%" warn={metrics.memoryPercent > 85} />
          <MetricCard label="Uptime" value={formatUptime(metrics.uptimeSeconds)} />
        </div>
      )}

      {alerts.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-[var(--color-red)] mb-3">Alert Attivi</h2>
          <div className="border border-[rgba(255,69,96,0.3)] rounded-lg overflow-hidden">
            {alerts.map(a => (
              <div key={a.thresholdId} className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)]" style={{ background: 'rgba(255,69,96,0.05)' }}>
                <span className="text-[10px] font-bold text-[var(--color-red)]">{a.metric}</span>
                <span className="flex-1 text-[11px] text-[var(--color-muted)]">{a.description}</span>
                <span className="font-mono text-[10px] text-[var(--color-red)]">{Math.round(a.currentValue)} &gt; {a.thresholdValue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold text-[var(--color-bright)] mb-3">Agenti</h2>
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          {agents.length === 0
            ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun agente registrato.</p></div>
            : agents.map(a => {
              const cfg = STATUS_CFG[a.status] || STATUS_CFG.dead;
              const ago = Math.floor((Date.now() - a.lastSeen) / 1000);
              return (
                <div key={a.agentId} className="flex items-center gap-4 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
                  <span className="text-[12px] font-semibold font-mono text-[var(--color-bright)]">{a.agentId}</span>
                  <span className="badge text-[9px]" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}40` }}>{a.status}</span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-[var(--color-dim)]">{ago < 60 ? `${ago}s fa` : `${Math.floor(ago / 60)}m fa`}</span>
                </div>
              );
            })
          }
        </div>
      </div>
    </div>
  )
}
