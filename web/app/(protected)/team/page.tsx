'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../../components/Toast'
import TeamOrgChart from './_components/TeamOrgChart'
import UsageChart from './_components/UsageChart'

/* ── Tipi ─────────────────────────────────────────────────────────── */

type AgentStatus = 'running' | 'stopped' | 'pending'

type AgentDef = {
  id: string
  name: string
  role: string
  color: string
  link: string | null
}

/* ── Definizioni agenti ───────────────────────────────────────────── */

const AGENTS: AgentDef[] = [
  { id: 'capitano',   name: 'Capitano',   role: 'Capitano',   color: '#ff9100', link: '/team/capitano'  },
  { id: 'sentinella', name: 'Sentinella', role: 'Sentinella', color: '#9c27b0', link: '/team/sentinella'},
  { id: 'scout',      name: 'Scout',      role: 'Scout',      color: '#2196f3', link: '/team/scout'     },
  { id: 'analista',   name: 'Analista',   role: 'Analista',   color: '#00e676', link: '/team/analista'  },
  { id: 'scorer',     name: 'Scorer',     role: 'Scorer',     color: '#b388ff', link: '/team/scorer'    },
  { id: 'scrittore',  name: 'Scrittore',  role: 'Scrittore',  color: '#ffd600', link: '/team/scrittore' },
  { id: 'critico',    name: 'Critico',    role: 'Critico',    color: '#f44336', link: '/team/critico'   },
  { id: 'assistente', name: 'Assistente', role: 'Assistente', color: '#26c6da', link: '/team/assistente'},
]

/* ── Componenti ───────────────────────────────────────────────────── */

function Spinner({ size = 14, color = '#ffc107' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="spinner-rotate" style={{ display: 'inline-block', verticalAlign: 'middle' }} aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/* ── Pagina ────────────────────────────────────────────────────────── */

export default function TeamPage() {
  const { toast } = useToast()
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>(() => {
    const init: Record<string, AgentStatus> = {}
    AGENTS.forEach(a => { init[a.id] = 'stopped' })
    return init
  })
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [bulkLoading, setBulkLoading] = useState<'start' | 'stop' | null>(null)
  const prevStatusesRef = useRef<Record<string, AgentStatus> | null>(null)

  // Assistente vive sempre (lifecycle legato al container Desktop, non
  // ai pulsanti Start/Stop all del team). Lo escludiamo dai conteggi
  // e dalle azioni bulk altrimenti il contatore resta inchiodato a 1
  // anche dopo uno Stop all "riuscito".
  const TEAM_AGENTS = AGENTS.filter(a => a.id !== 'assistente')
  const activeCount = TEAM_AGENTS.filter(a => statuses[a.id] === 'running').length

  /* ── Fetch status ────────────────────────────────────────────── */

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      const agentList: { id: string; status: string }[] = data.agents ?? []

      // Compute next fuori dall'updater: chiamare `toast()` dentro
      // un updater di setState triggera React warning "Cannot update
      // ToastProvider while rendering TeamPage" perché React può
      // rigiocare la callback durante il render. Stato + effetto
      // esterno (toast) vanno tenuti separati.
      const next: Record<string, AgentStatus> = {}
      AGENTS.forEach(a => {
        const found = agentList.find(x => x.id === a.id)
        next[a.id] = (found?.status as AgentStatus) ?? 'stopped'
      })

      const prevRef = prevStatusesRef.current
      if (prevRef) {
        AGENTS.forEach(a => {
          const was = prevRef[a.id]
          const now = next[a.id]
          if (was === now) return
          if (was !== 'running' && now === 'running') {
            toast(`${a.name} is online`, 'success', 3000)
          } else if (was === 'running' && now === 'stopped') {
            toast(`${a.name} stopped`, 'warning', 3000)
          }
        })
      }
      prevStatusesRef.current = next
      setStatuses(next)
    } catch { /* ignore */ }
  }, [toast])

  /* ── Polling ─────────────────────────────────────────────────── */

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  /* ── Start/Stop ──────────────────────────────────────────────── */

  const handleAction = async (agentId: string, action: 'start' | 'stop') => {
    setActionLoading(agentId)
    if (action === 'start') {
      setStatuses(prev => ({ ...prev, [agentId]: 'pending' }))
    }
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, action }),
      })
      const data = await res.json()
      if (!data.ok && data.error) {
        toast(data.error, 'error', 4000)
      }
      // Refresh status dopo l'azione
      setTimeout(fetchStatus, 1500)
    } catch {
      toast('Network error', 'error', 4000)
    }
    setActionLoading(null)
  }

  /* ── Azioni bulk ─────────────────────────────────────────────── */

  const startAll = async () => {
    if (bulkLoading) return
    setBulkLoading('start')
    setStatuses(prev => {
      const next = { ...prev }
      TEAM_AGENTS.forEach(a => { if (next[a.id] !== 'running') next[a.id] = 'pending' })
      return next
    })
    try {
      const res = await fetch('/api/team/start-all', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || (data && data.ok === false)) {
        toast(data?.error ?? 'Team start error', 'error', 4000)
      }
    } catch {
      toast('Team start error', 'error')
    } finally {
      setBulkLoading(null)
      fetchStatus()
    }
  }

  const stopAll = async () => {
    if (bulkLoading) return
    setBulkLoading('stop')
    try {
      const res = await fetch('/api/team/stop-all', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || (data && data.ok === false)) {
        toast(data?.error ?? 'Team stop error', 'error', 4000)
      }
    } catch {
      toast('Team stop error', 'error')
    } finally {
      setBulkLoading(null)
      fetchStatus()
    }
  }

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      <style>{`
        @keyframes spinner-rotate {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spinner-rotate { animation: spinner-rotate 0.8s linear infinite; }
      `}</style>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Team</span>
        </nav>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Job Hunter Team</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {activeCount}/{TEAM_AGENTS.length} agents active
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={startAll}
              disabled={activeCount === TEAM_AGENTS.length || bulkLoading !== null}
              className="px-4 py-2 rounded-lg text-[11px] font-semibold tracking-wide transition-all"
              style={{
                background: activeCount === TEAM_AGENTS.length || bulkLoading !== null ? 'var(--color-border)' : 'rgba(34,197,94,0.1)',
                color: activeCount === TEAM_AGENTS.length || bulkLoading !== null ? 'var(--color-dim)' : '#22c55e',
                border: `1px solid ${activeCount === TEAM_AGENTS.length || bulkLoading !== null ? 'var(--color-border)' : 'rgba(34,197,94,0.25)'}`,
                cursor: activeCount === TEAM_AGENTS.length || bulkLoading !== null ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                minWidth: 110,
              }}
            >
              {bulkLoading === 'start' ? (
                <span className="inline-flex items-center gap-1.5"><Spinner size={11} color="var(--color-dim)" /> Starting...</span>
              ) : activeCount === TEAM_AGENTS.length ? (
                '\u2713 All active'
              ) : (
                '\u25B6 Start all'
              )}
            </button>
            {activeCount > 0 && (
              <button
                onClick={stopAll}
                disabled={bulkLoading !== null}
                className="px-4 py-2 rounded-lg text-[11px] font-semibold tracking-wide transition-all"
                style={{
                  background: bulkLoading !== null ? 'var(--color-border)' : 'rgba(244,67,54,0.08)',
                  color: bulkLoading !== null ? 'var(--color-dim)' : '#f44336',
                  border: `1px solid ${bulkLoading !== null ? 'var(--color-border)' : 'rgba(244,67,54,0.2)'}`,
                  cursor: bulkLoading !== null ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  minWidth: 110,
                }}
              >
                {bulkLoading === 'stop' ? (
                  <span className="inline-flex items-center gap-1.5"><Spinner size={11} color="var(--color-dim)" /> Stopping...</span>
                ) : (
                  <>{'\u25A0'} Stop all</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Org chart */}
      <section className="py-10">
        <div className="mx-auto w-full max-w-[1080px]">
          <TeamOrgChart
            agents={Object.fromEntries(AGENTS.map(a => [a.id, {
              status: statuses[a.id] ?? 'stopped',
              color: a.color,
              link: a.link,
              role: a.role,
            }]))}
            onAction={handleAction}
            actionLoading={actionLoading}
          />
        </div>
      </section>

      {/* Rate budget chart */}
      <section className="py-10 border-t border-[var(--color-border)]">
        <div className="mx-auto w-full max-w-[900px]">
          <UsageChart />
        </div>
      </section>

      {/* Footer hint */}
      <div className="mt-6 pt-4 border-t border-[var(--color-border)] text-center">
        <p className="text-[10px] text-[var(--color-dim)]">
          Auto refresh every 5s &middot; Click an agent emoji for details
        </p>
      </div>
    </div>
  )
}
