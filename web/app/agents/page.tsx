'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type AgentStatus = 'active' | 'idle' | 'starting' | 'stopping'

type Agent = {
  session: string
  role: string
  emoji: string
  color: string
  status: AgentStatus
}

const KNOWN_AGENTS: Omit<Agent, 'status'>[] = [
  { session: 'ALFA',         role: 'Capitano',   emoji: '👨‍✈️', color: '#ff9100' },
  { session: 'SCOUT-1',      role: 'Scout',       emoji: '🕵️',  color: '#2196f3' },
  { session: 'ANALISTA-1',   role: 'Analista',    emoji: '🔬',  color: '#00e676' },
  { session: 'SCORER-1',     role: 'Scorer',      emoji: '📊',  color: '#b388ff' },
  { session: 'SCRITTORE-1',  role: 'Scrittore',   emoji: '✍️',  color: '#ffd600' },
  { session: 'CRITICO',      role: 'Critico',     emoji: '⚖️',  color: '#f44336' },
  { session: 'SENTINELLA',   role: 'Sentinella',  emoji: '🛡️',  color: '#607d8b' },
]

function StatusBadge({ status }: { status: AgentStatus }) {
  const cfg = {
    active:   { label: 'attivo',   color: 'var(--color-green)', bg: 'rgba(0,232,122,0.1)',  border: 'rgba(0,232,122,0.3)' },
    idle:     { label: 'offline',  color: 'var(--color-muted)', bg: 'transparent',           border: 'var(--color-border)' },
    starting: { label: 'avvio…',   color: 'var(--color-yellow)',bg: 'rgba(245,197,24,0.1)',  border: 'rgba(245,197,24,0.3)' },
    stopping: { label: 'stop…',    color: 'var(--color-red)',   bg: 'rgba(255,69,96,0.1)',   border: 'rgba(255,69,96,0.3)' },
  }[status]
  return (
    <span className="badge" style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      {cfg.label}
    </span>
  )
}

function AgentCard({ agent, onToggle }: { agent: Agent; onToggle: (session: string) => void }) {
  const busy = agent.status === 'starting' || agent.status === 'stopping'
  const isActive = agent.status === 'active'
  return (
    <div className="flex items-center gap-4 px-5 py-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] hover:border-[var(--color-border-glow)] transition-colors" style={{ animation: 'fade-in 0.3s ease both' }}>
      <div className="text-2xl w-8 text-center flex-shrink-0" aria-hidden="true">{agent.emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-semibold text-[var(--color-bright)]">{agent.role}</span>
          <StatusBadge status={agent.status} />
        </div>
        <div className="text-[10px] text-[var(--color-dim)] font-mono">{agent.session}</div>
      </div>
      <button
        onClick={() => onToggle(agent.session)}
        disabled={busy}
        style={{
          border: `1px solid ${isActive ? 'rgba(255,69,96,0.4)' : 'rgba(0,232,122,0.4)'}`,
          color: isActive ? 'var(--color-red)' : 'var(--color-green)',
          background: isActive ? 'rgba(255,69,96,0.06)' : 'rgba(0,232,122,0.06)',
          fontFamily: 'inherit',
          fontSize: '11px',
          padding: '5px 14px',
          borderRadius: '4px',
          cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.5 : 1,
          letterSpacing: '0.05em',
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
        }}
      >
        {agent.status === 'starting' ? '↻ avvio…' : agent.status === 'stopping' ? '↻ stop…' : isActive ? '■ Stop' : '▶ Start'}
      </button>
    </div>
  )
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>(
    KNOWN_AGENTS.map(a => ({ ...a, status: 'idle' as AgentStatus }))
  )

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/team/status').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    const activeSessions = new Set<string>((data.agents ?? []).map((a: { session: string }) => a.session))
    setAgents(prev => prev.map(a => ({
      ...a,
      status: (a.status === 'starting' || a.status === 'stopping')
        ? a.status
        : activeSessions.has(a.session) ? 'active' : 'idle',
    })))
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])
  useEffect(() => {
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [fetchStatus])

  const toggleAgent = async (session: string) => {
    const agent = agents.find(a => a.session === session)
    if (!agent || agent.status === 'starting' || agent.status === 'stopping') return
    const action = agent.status === 'active' ? 'stop' : 'start'
    setAgents(prev => prev.map(a => a.session === session ? { ...a, status: action === 'stop' ? 'stopping' : 'starting' } : a))
    await fetch(`/api/agents/${session}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(() => null)
    setTimeout(fetchStatus, 2000)
  }

  const activeCount = agents.filter(a => a.status === 'active').length

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Agenti</span>
        </nav>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Agenti</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{activeCount}/{agents.length} attivi</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {agents.map((agent, i) => (
          <div key={agent.session} style={{ animation: `fade-in 0.4s ease ${i * 0.06}s both` }}>
            <AgentCard agent={agent} onToggle={toggleAgent} />
          </div>
        ))}
      </div>
    </div>
  )
}
