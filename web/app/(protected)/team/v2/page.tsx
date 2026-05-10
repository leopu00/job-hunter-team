'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import TeamOrgChart from '../_components/TeamOrgChart'

type AgentStatus = 'running' | 'stopped' | 'pending'

const COLORS: Record<string, string> = {
  capitano:   '#ff9100',
  sentinella: '#9c27b0',
  scout:      '#2196f3',
  analista:   '#00e676',
  scorer:     '#b388ff',
  scrittore:  '#ffd600',
  critico:    '#f44336',
}

type AgentInfo = { status: AgentStatus; instances: number }

export default function TeamV2Page() {
  const [info, setInfo] = useState<Record<string, AgentInfo>>({})

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      if (!res.ok) return
      const data = await res.json()
      if (!Array.isArray(data?.agents)) return
      const next: Record<string, AgentInfo> = {}
      for (const a of data.agents as { id: string; status: string; instances?: number }[]) {
        next[a.id] = {
          status: (a.status as AgentStatus) ?? 'stopped',
          instances: typeof a.instances === 'number' ? a.instances : (a.status === 'running' ? 1 : 0),
        }
      }
      setInfo(next)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    const t = setInterval(fetchStatus, 3000)
    return () => clearInterval(t)
  }, [fetchStatus])

  const agentMeta = Object.fromEntries(
    Object.entries(COLORS).map(([id, color]) => [id, {
      status: info[id]?.status ?? 'stopped',
      instances: info[id]?.instances ?? 0,
      color,
      role: id,
      link: `/team/${id}`,
    }]),
  ) as Record<string, { status: AgentStatus; instances: number; color: string; role: string; link: string }>

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <Link href="/team" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Team</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">v2</span>
        </nav>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Job Hunter Team — v2</h1>
          </div>
          <Link
            href="/team"
            className="px-2.5 py-1.5 rounded-md text-[10px] tracking-wide no-underline transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--color-muted)',
              border: '1px dashed var(--color-border)',
              fontFamily: 'inherit',
            }}
            title="Torna alla pagina Team v1"
          >
            ← v1
          </Link>
        </div>
      </div>

      <section className="py-12">
        <div className="mx-auto w-full max-w-[1080px]">
          <TeamOrgChart hideStopped agents={agentMeta} />
        </div>
      </section>
    </div>
  )
}
