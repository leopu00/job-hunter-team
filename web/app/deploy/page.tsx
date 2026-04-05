'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type ServiceStatus = 'ok' | 'error' | 'timeout' | 'unknown'
type ServiceHealth = { name: string; url?: string; ok: boolean; status: ServiceStatus; httpStatus?: number; ms?: number; error?: string }
type AgentInfo = { session: string; active: boolean }
type DeployReport = { ok: boolean; ts: number; durationMs: number; services: ServiceHealth[]; agents: AgentInfo[]; activeAgents: number; totalAgents: number }

const STATUS_CFG: Record<ServiceStatus, { icon: string; color: string; label: string }> = {
  ok:      { icon: '●', color: 'var(--color-green)',  label: 'ok' },
  error:   { icon: '✗', color: 'var(--color-red)',    label: 'errore' },
  timeout: { icon: '◌', color: 'var(--color-orange)', label: 'timeout' },
  unknown: { icon: '○', color: 'var(--color-dim)',    label: 'sconosciuto' },
}

function ServiceRow({ svc }: { svc: ServiceHealth }) {
  const cfg = STATUS_CFG[svc.status]
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-[var(--color-border)] last:border-0">
      <span style={{ color: cfg.color, animation: svc.ok ? 'pulse-dot 3s ease-in-out infinite' : undefined }}>{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-semibold" style={{ color: svc.ok ? 'var(--color-bright)' : cfg.color }}>{svc.name}</span>
        {svc.url && <span className="ml-2 text-[10px] font-mono text-[var(--color-dim)]">{svc.url}</span>}
        {svc.error && <p className="text-[10px] text-[var(--color-red)] mt-0.5 truncate" role="alert">{svc.error}</p>}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {svc.ms != null && <span className="text-[10px] text-[var(--color-dim)]">{svc.ms}ms</span>}
        {svc.httpStatus && <span className="text-[10px] font-mono" style={{ color: svc.ok ? 'var(--color-muted)' : cfg.color }}>{svc.httpStatus}</span>}
        <span className="badge text-[9px]" style={{ color: cfg.color, border: `1px solid ${cfg.color}33`, background: `${cfg.color}0d` }}>{cfg.label}</span>
      </div>
    </div>
  )
}

function AgentGrid({ agents }: { agents: AgentInfo[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {agents.map(a => (
        <div key={a.session} className="flex items-center gap-2 px-3 py-2 rounded border text-[11px]"
          style={{ borderColor: a.active ? 'rgba(0,232,122,0.25)' : 'var(--color-border)', background: a.active ? 'rgba(0,232,122,0.04)' : 'transparent' }}>
          <span style={{ color: a.active ? 'var(--color-green)' : 'var(--color-dim)', animation: a.active ? 'pulse-dot 2s ease-in-out infinite' : undefined }}>●</span>
          <span className="font-mono truncate" style={{ color: a.active ? 'var(--color-bright)' : 'var(--color-dim)' }}>{a.session}</span>
        </div>
      ))}
    </div>
  )
}

export default function DeployPage() {
  const [report, setReport] = useState<DeployReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastCheck, setLastCheck] = useState<Date | null>(null)

  const fetchReport = useCallback(async () => {
    const res = await fetch('/api/deploy').catch(() => null)
    if (res?.ok) {
      setReport(await res.json())
      setLastCheck(new Date())
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchReport() }, [fetchReport])
  useEffect(() => {
    const id = setInterval(fetchReport, 30_000)
    return () => clearInterval(id)
  }, [fetchReport])

  const overall = report?.ok
  const httpServices = report?.services.filter(s => s.url) ?? []
  const tmuxServices = report?.services.filter(s => !s.url) ?? []

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Deploy</span>
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] flex items-center gap-3">
              Deploy
              {report && (
                <span className="text-sm font-normal px-2.5 py-0.5 rounded-full border"
                  style={{ color: overall ? 'var(--color-green)' : 'var(--color-red)', borderColor: overall ? 'rgba(0,232,122,0.3)' : 'rgba(255,69,96,0.3)', background: overall ? 'rgba(0,232,122,0.08)' : 'rgba(255,69,96,0.08)' }}>
                  {overall ? '● sistema ok' : '✗ problemi rilevati'}
                </span>
              )}
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {lastCheck ? `Aggiornato ${lastCheck.toLocaleTimeString('it-IT')}` : 'Caricamento…'}
              {report && ` · ${report.durationMs}ms`}
            </p>
          </div>
          <button onClick={fetchReport} disabled={loading}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-green)'; e.currentTarget.style.color = 'var(--color-green)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-muted)' }}>
            ↻ verifica ora
          </button>
        </div>
      </div>

      {loading && <div className="flex justify-center py-16" role="status" aria-live="polite"><span className="text-[var(--color-dim)] text-[12px]">Health check in corso…</span></div>}

      {report && (<>
        {/* Servizi HTTP */}
        {httpServices.length > 0 && (
          <div className="mb-6">
            <div className="section-label">Servizi HTTP</div>
            <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
              {httpServices.map(s => <ServiceRow key={s.name} svc={s} />)}
            </div>
          </div>
        )}

        {/* Processi tmux */}
        {tmuxServices.length > 0 && (
          <div className="mb-6">
            <div className="section-label">Processi di sistema</div>
            <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
              {tmuxServices.map(s => <ServiceRow key={s.name} svc={s} />)}
            </div>
          </div>
        )}

        {/* Agenti */}
        <div className="mb-6">
          <div className="section-label">
            Agenti — {report.activeAgents}/{report.totalAgents} attivi
          </div>
          <AgentGrid agents={report.agents} />
        </div>
      </>)}
    </div>
  )
}
