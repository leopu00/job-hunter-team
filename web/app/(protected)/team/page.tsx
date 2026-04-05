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
  { id: 'alfa',       name: 'Alfa',       role: 'Capitano',   emoji: '\u{1F468}\u200D\u2708\uFE0F', color: '#ff9100', session: 'ALFA',       link: '/capitano',  desc: 'Coordina il team e le priorità' },
  { id: 'scout',      name: 'Scout',      role: 'Scout',      emoji: '\uD83D\uDD75\uFE0F',         color: '#2196f3', session: 'SCOUT-1',    link: '/scout',     desc: 'Cerca offerte di lavoro' },
  { id: 'analista',   name: 'Analista',   role: 'Analista',   emoji: '\u{1F468}\u200D\uD83D\uDD2C', color: '#00e676', session: 'ANALISTA-1', link: '/analista',  desc: 'Analizza requisiti e fit' },
  { id: 'scorer',     name: 'Scorer',     role: 'Scorer',     emoji: '\u{1F468}\u200D\uD83D\uDCBB', color: '#b388ff', session: 'SCORER-1',   link: '/scorer',    desc: 'Calcola il match score' },
  { id: 'scrittore',  name: 'Scrittore',  role: 'Scrittore',  emoji: '\u{1F468}\u200D\uD83C\uDFEB', color: '#ffd600', session: 'SCRITTORE-1', link: '/scrittore', desc: 'Genera CV e cover letter' },
  { id: 'critico',    name: 'Critico',    role: 'Critico',    emoji: '\u{1F468}\u200D\u2696\uFE0F', color: '#f44336', session: 'CRITICO',    link: '/critico',   desc: 'Revisiona i documenti' },
  { id: 'sentinella', name: 'Sentinella', role: 'Sentinella', emoji: '\uD83D\uDC82',                color: '#607d8b', session: 'SENTINELLA', link: '/sentinella', desc: 'Monitora budget e rate limit' },
  { id: 'assistente', name: 'Assistente', role: 'Assistente', emoji: '\uD83E\uDD16',                color: '#26c6da', session: 'ASSISTENTE', link: '/assistente', desc: 'Chat AI per l\'utente' },
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
      aria-label={status === 'running' ? 'online' : status === 'pending' ? 'in avvio' : 'offline'}
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
    pending: { text: 'Avvio...', color: '#f59e0b' },
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
      aria-label={`${agent.name} — ${status === 'running' ? 'online' : status === 'pending' ? 'in avvio' : 'offline'}`}
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
          aria-label={isRunning ? `Ferma ${agent.name}` : `Avvia ${agent.name}`}
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
              <Spinner size={10} color="var(--color-dim)" /> Attendi...
            </span>
          ) : isRunning ? (
            '\u25A0 Ferma'
          ) : (
            '\u25B6 Avvia'
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

  const activeCount = AGENTS.filter(a => statuses[a.id] === 'running').length

  /* ── Fetch status ────────────────────────────────────────────── */

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      const agentList: { id: string; status: string }[] = data.agents ?? []

      setStatuses(prev => {
        const next = { ...prev }
        AGENTS.forEach(a => {
          const found = agentList.find(x => x.id === a.id)
          next[a.id] = (found?.status as AgentStatus) ?? 'stopped'
        })

        // Toast per cambi di stato
        const prevRef = prevStatusesRef.current
        if (prevRef) {
          AGENTS.forEach(a => {
            const was = prevRef[a.id]
            const now = next[a.id]
            if (was === now) return
            if (was !== 'running' && now === 'running') {
              toast(`${a.name} è online`, 'success', 3000)
            } else if (was === 'running' && now === 'stopped') {
              toast(`${a.name} si è fermato`, 'warning', 3000)
            }
          })
        }
        prevStatusesRef.current = { ...next }
        return next
      })
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
      toast('Errore di rete', 'error', 4000)
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
      toast('Errore avvio team', 'error')
    }
  }

  const stopAll = async () => {
    try {
      await fetch('/api/team/stop-all', { method: 'POST' })
      setTimeout(fetchStatus, 2000)
    } catch {
      toast('Errore stop team', 'error')
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
              {activeCount}/{AGENTS.length} agenti attivi
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              {activeCount === AGENTS.length ? '\u2713 Tutti attivi' : '\u25B6 Avvia tutti'}
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
                {'\u25A0'} Ferma tutti
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Agent Grid */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', animation: 'fade-in 0.35s ease both' }}
      >
        {AGENTS.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            status={statuses[agent.id] ?? 'stopped'}
            onAction={handleAction}
            actionLoading={actionLoading}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div className="mt-8 pt-4 border-t border-[var(--color-border)] text-center">
        <p className="text-[10px] text-[var(--color-dim)]">
          Aggiornamento automatico ogni 5s &middot; Clicca un nome per i dettagli
        </p>
      </div>
    </div>
  )
}
