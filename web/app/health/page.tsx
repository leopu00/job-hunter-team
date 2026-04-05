'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Status = 'ok' | 'warn' | 'error'
type ModuleCheck = { id: string; label: string; status: Status; detail: string }
type HealthData = { status: Status; version: string; uptime: number; timestamp: number; modules: ModuleCheck[]; counts: { ok: number; warn: number; error: number } }

const STATUS_COLORS: Record<Status, string> = { ok: 'var(--color-green)', warn: 'var(--color-yellow)', error: 'var(--color-red)' }
const STATUS_LABELS: Record<Status, string> = { ok: 'Operativo', warn: 'Attenzione', error: 'Errore' }

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  const h = Math.floor(s / 3600)
  return `${h}h ${Math.floor((s % 3600) / 60)}m`
}

function OverallBadge({ status }: { status: Status }) {
  const color = STATUS_COLORS[status]
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 h-3 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <span className="text-[14px] font-bold uppercase tracking-wider" style={{ color }}>{STATUS_LABELS[status]}</span>
    </div>
  )
}

function ModuleCard({ m }: { m: ModuleCheck }) {
  const color = STATUS_COLORS[m.status]
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: m.status !== 'ok' ? `0 0 6px ${color}` : 'none' }} />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-[var(--color-bright)]">{m.label}</p>
        <p className="text-[10px] text-[var(--color-dim)] mt-0.5">{m.detail}</p>
      </div>
      <span className="text-[9px] px-2 py-0.5 rounded uppercase tracking-wider font-semibold" style={{ background: `${color}22`, color }}>{m.status}</span>
    </div>
  )
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastCheck, setLastCheck] = useState<string>('')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/health').catch(() => null)
    if (res?.ok) {
      setData(await res.json())
      setLastCheck(new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { const iv = setInterval(fetchData, 10000); return () => clearInterval(iv) }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Health</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Health Check</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">Stato sistema — moduli, versione, uptime</p>
          </div>
          {data && <OverallBadge status={data.status} />}
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse">Caricamento...</p>
      ) : !data ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Errore nel caricamento.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-1">Versione</p>
              <p className="text-lg font-bold text-[var(--color-bright)]">v{data.version}</p>
            </div>
            <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-1">Uptime</p>
              <p className="text-lg font-bold text-[var(--color-bright)]">{fmtUptime(data.uptime)}</p>
            </div>
            <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-1">Moduli OK</p>
              <p className="text-lg font-bold text-[var(--color-green)]">{data.counts.ok}/{data.modules.length}</p>
            </div>
            <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-1">Ultimo check</p>
              <p className="text-lg font-bold text-[var(--color-muted)]">{lastCheck}</p>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)]">Moduli</p>
              <div className="flex gap-3 text-[9px]">
                {data.counts.error > 0 && <span style={{ color: 'var(--color-red)' }}>{data.counts.error} errori</span>}
                {data.counts.warn > 0 && <span style={{ color: 'var(--color-yellow)' }}>{data.counts.warn} warning</span>}
              </div>
            </div>
            {data.modules.map(m => <ModuleCard key={m.id} m={m} />)}
          </div>
        </>
      )}
    </div>
  )
}
