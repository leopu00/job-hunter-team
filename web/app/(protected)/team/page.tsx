'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useToast } from '../../components/Toast'

/* ── Tipi ─────────────────────────────────────────────────────────── */

type AgentStatus = 'running' | 'stopped' | 'pending'

type AgentDef = {
  id: string
  name: string
  role: string
  emoji: string
  color: string
  session: string
  link: string | null
  desc: string
}

/* ── Definizioni agenti ───────────────────────────────────────────── */

const AGENTS: AgentDef[] = [
  { id: 'capitano',       name: 'Capitano',       role: 'Capitano',   emoji: '\u{1F468}\u200D\u2708\uFE0F', color: '#ff9100', session: 'CAPITANO',       link: '/team/capitano',  desc: 'Coordinates the team and priorities' },
  { id: 'scout',      name: 'Scout',      role: 'Scout',      emoji: '\uD83D\uDD75\uFE0F',         color: '#2196f3', session: 'SCOUT-1',    link: '/team/scout',     desc: 'Searches job listings' },
  { id: 'analista',   name: 'Analista',   role: 'Analista',   emoji: '\u{1F468}\u200D\uD83D\uDD2C', color: '#00e676', session: 'ANALISTA-1', link: '/team/analista',  desc: 'Analyzes requirements and fit' },
  { id: 'scorer',     name: 'Scorer',     role: 'Scorer',     emoji: '\u{1F468}\u200D\uD83D\uDCBB', color: '#b388ff', session: 'SCORER-1',   link: '/team/scorer',    desc: 'Calculates match score' },
  { id: 'scrittore',  name: 'Scrittore',  role: 'Scrittore',  emoji: '\u{1F468}\u200D\uD83C\uDFEB', color: '#ffd600', session: 'SCRITTORE-1', link: '/team/scrittore', desc: 'Generates CV and cover letter' },
  { id: 'critico',    name: 'Critico',    role: 'Critico',    emoji: '\u{1F468}\u200D\u2696\uFE0F', color: '#f44336', session: 'CRITICO',    link: '/team/critico',   desc: 'Reviews documents' },
  { id: 'sentinella', name: 'Sentinella', role: 'Sentinella', emoji: '\uD83D\uDC82',                color: '#607d8b', session: 'SENTINELLA', link: '/team/sentinella', desc: 'Monitors budget and rate limits' },
  { id: 'assistente', name: 'Assistente', role: 'Assistente', emoji: '\u{1F468}\u200D\u{1F4BC}',    color: '#26c6da', session: 'ASSISTENTE', link: '/team/assistente', desc: 'AI chat for user' },
]

/* ── Componenti ───────────────────────────────────────────────────── */

function StatusDot({ status }: { status: AgentStatus }) {
  const config = {
    running: { bg: '#22c55e', shadow: '0 0 8px rgba(34,197,94,0.5)', pulse: false },
    pending: { bg: '#f59e0b', shadow: '0 0 8px rgba(245,158,11,0.5)', pulse: true },
    stopped: { bg: 'rgba(255,255,255,0.15)', shadow: 'none', pulse: false },
  }
  const c = config[status]
  return (
    <span
      className={c.pulse ? 'status-pulse' : ''}
      role="status"
      aria-label={status === 'running' ? 'online' : status === 'pending' ? 'starting' : 'offline'}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: c.bg,
        boxShadow: c.shadow,
        transition: 'all 0.3s',
      }}
    />
  )
}

function StatusLabel({ status }: { status: AgentStatus }) {
  const labels: Record<AgentStatus, { text: string; color: string }> = {
    running: { text: 'Online', color: '#22c55e' },
    pending: { text: 'Starting...', color: '#f59e0b' },
    stopped: { text: 'Offline', color: 'var(--color-dim)' },
  }
  const l = labels[status]
  return (
    <span className="text-[10px] font-semibold tracking-wide uppercase" style={{ color: l.color }}>
      {l.text}
    </span>
  )
}

function AgentCard({
  agent,
  status,
  onAction,
  actionLoading,
}: {
  agent: AgentDef
  status: AgentStatus
  onAction: (id: string, action: 'start' | 'stop') => void
  actionLoading: string | null
}) {
  const isLoading = actionLoading === agent.id
  const isRunning = status === 'running'

  return (
    <div
      className="rounded-xl p-4 transition-all duration-150 hover:border-[var(--color-border-glow)]"
      role="article"
      aria-label={`${agent.name} — ${status === 'running' ? 'online' : status === 'pending' ? 'starting' : 'offline'}`}
      style={{
        background: 'var(--color-panel)',
        border: `1px solid ${isRunning ? `${agent.color}33` : 'var(--color-border)'}`,
      }}
    >
      {/* Header: emoji + name + status dot */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: `${agent.color}15`, border: `1px solid ${agent.color}30` }}
          >
            {agent.emoji}
          </div>
          <div>
            <div className="flex items-center gap-2">
              {agent.link ? (
                <Link href={agent.link} className="text-[13px] font-bold no-underline hover:underline" style={{ color: 'var(--color-white)' }}>
                  {agent.name}
                </Link>
              ) : (
                <span className="text-[13px] font-bold" style={{ color: 'var(--color-white)' }}>{agent.name}</span>
              )}
            </div>
            <p className="text-[10px] font-semibold tracking-wide uppercase mt-0.5" style={{ color: agent.color }}>
              {agent.role}
            </p>
          </div>
        </div>
        <StatusDot status={status} />
      </div>

      {/* Description */}
      <p className="text-[11px] leading-relaxed mb-3" style={{ color: 'var(--color-muted)' }}>
        {agent.desc}
      </p>

      {/* Status + Action */}
      <div className="flex items-center justify-between gap-2 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        <StatusLabel status={status} />

        <button
          onClick={() => onAction(agent.id, isRunning ? 'stop' : 'start')}
          disabled={isLoading || status === 'pending'}
          aria-label={isRunning ? `Stop ${agent.name}` : `Start ${agent.name}`}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
          style={{
            background: isLoading || status === 'pending'
              ? 'var(--color-border)'
              : isRunning
                ? 'rgba(244,67,54,0.08)'
                : `${agent.color}15`,
            color: isLoading || status === 'pending'
              ? 'var(--color-dim)'
              : isRunning
                ? '#f44336'
                : agent.color,
            border: `1px solid ${
              isLoading || status === 'pending'
                ? 'var(--color-border)'
                : isRunning
                  ? 'rgba(244,67,54,0.2)'
                  : `${agent.color}30`
            }`,
            cursor: isLoading || status === 'pending' ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <Spinner size={10} color="var(--color-dim)" /> Wait...
            </span>
          ) : isRunning ? (
            '\u25A0 Stop'
          ) : (
            '\u25B6 Start'
          )}
        </button>
      </div>
    </div>
  )
}

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
  const prevStatusesRef = useRef<Record<string, AgentStatus> | null>(null)

  /* ── Provider switcher (dev-friendly) ────────────────────────── */
  const [provider, setProvider] = useState<string>('')
  const [providerList, setProviderList] = useState<Array<{ id: string; label: string }>>([])
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    fetch('/api/providers')
      .then(r => r.json())
      .then((data: { providers?: Array<{ id: string; label: string; active?: boolean }> }) => {
        const list = data.providers ?? []
        setProviderList(list.map(p => ({ id: p.id, label: p.label })))
        const active = list.find(p => p.active)
        if (active) setProvider(active.id)
      })
      .catch(() => { /* endpoint down */ })
  }, [])

  const switchProvider = async (newProvider: string, restart: boolean) => {
    if (!newProvider || newProvider === provider) return
    setSwitching(true)
    try {
      const r = await fetch('/api/providers/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: newProvider }),
      })
      const j = await r.json()
      if (!j?.ok) { toast(j?.error || 'Errore switch provider', 'warning', 4000); return }
      setProvider(newProvider)
      toast(`Provider: ${newProvider}`, 'success', 2000)
      if (restart) {
        await fetch('/api/team/stop-all', { method: 'POST' })
        await new Promise(r => setTimeout(r, 1500))
        await fetch('/api/team/start-all', { method: 'POST' })
        toast('Team riavviato col nuovo provider', 'success', 3000)
        setTimeout(fetchStatus, 2000)
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Errore di rete', 'warning', 4000)
    } finally {
      setSwitching(false)
    }
  }

  const activeCount = AGENTS.filter(a => statuses[a.id] === 'running').length

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
    setStatuses(prev => {
      const next = { ...prev }
      AGENTS.forEach(a => { if (next[a.id] !== 'running') next[a.id] = 'pending' })
      return next
    })
    try {
      await fetch('/api/team/start-all', { method: 'POST' })
      setTimeout(fetchStatus, 2000)
    } catch {
      toast('Team start error', 'error')
    }
  }

  const stopAll = async () => {
    try {
      await fetch('/api/team/stop-all', { method: 'POST' })
      setTimeout(fetchStatus, 2000)
    } catch {
      toast('Team stop error', 'error')
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
        @keyframes status-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .status-pulse { animation: status-pulse 1.5s ease-in-out infinite; }
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
              {activeCount}/{AGENTS.length} agents active
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {providerList.length > 0 && (
              <div className="flex items-center gap-1.5 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-3 py-1.5">
                <span className="text-[9px] uppercase tracking-[0.15em] text-[var(--color-dim)]">Provider</span>
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  disabled={switching}
                  className="bg-transparent text-[11px] text-[var(--color-base)] font-mono outline-none cursor-pointer"
                  style={{ border: 'none' }}
                >
                  {providerList.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => switchProvider(provider, activeCount > 0)}
                  disabled={switching}
                  title={activeCount > 0 ? 'Salva provider + stop/start team' : 'Salva provider'}
                  className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded"
                  style={{
                    background: switching ? 'var(--color-border)' : 'rgba(96,125,139,0.2)',
                    color: switching ? 'var(--color-dim)' : '#90a4ae',
                    border: '1px solid rgba(96,125,139,0.3)',
                    cursor: switching ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {switching ? '…' : (activeCount > 0 ? 'Apply + restart' : 'Apply')}
                </button>
              </div>
            )}
            <button
              onClick={startAll}
              disabled={activeCount === AGENTS.length}
              className="px-4 py-2 rounded-lg text-[11px] font-semibold tracking-wide transition-all"
              style={{
                background: activeCount === AGENTS.length ? 'var(--color-border)' : 'rgba(34,197,94,0.1)',
                color: activeCount === AGENTS.length ? 'var(--color-dim)' : '#22c55e',
                border: `1px solid ${activeCount === AGENTS.length ? 'var(--color-border)' : 'rgba(34,197,94,0.25)'}`,
                cursor: activeCount === AGENTS.length ? 'default' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {activeCount === AGENTS.length ? '\u2713 All active' : '\u25B6 Start all'}
            </button>
            {activeCount > 0 && (
              <button
                onClick={stopAll}
                className="px-4 py-2 rounded-lg text-[11px] font-semibold tracking-wide transition-all"
                style={{
                  background: 'rgba(244,67,54,0.08)',
                  color: '#f44336',
                  border: '1px solid rgba(244,67,54,0.2)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {'\u25A0'} Stop all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Agent Grid */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      >
        {AGENTS.map((agent, i) => (
          <div key={agent.id} style={{ animation: `fade-in 0.4s ease ${i * 0.06}s both` }}>
            <AgentCard
              agent={agent}
              status={statuses[agent.id] ?? 'stopped'}
              onAction={handleAction}
              actionLoading={actionLoading}
            />
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <div className="mt-8 pt-4 border-t border-[var(--color-border)] text-center">
        <p className="text-[10px] text-[var(--color-dim)]">
          Auto refresh every 5s &middot; Click a name for details
        </p>
      </div>
    </div>
  )
}
