'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Overview = {
  agents: { total: number; running: number }
  analytics: { calls: number; tokens: number; costUsd: number; errors: number }
  credentials: { total: number; configured: number }
  plugins: { total: number; enabled: number }
  memory: { total: number; existing: number }
}

function StatCard({ label, value, sub, color, href }: { label: string; value: string; sub?: string; color: string; href: string }) {
  return (
    <Link href={href} className="block p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] hover:border-[var(--color-border-glow)] transition-colors no-underline">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--color-muted)] mt-0.5">{sub}</p>}
    </Link>
  )
}

function SectionLink({ href, title, desc, accent }: { href: string; title: string; desc: string; accent: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] hover:border-[var(--color-border-glow)] transition-colors no-underline">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-[var(--color-bright)]">{title}</p>
        <p className="text-[10px] text-[var(--color-dim)] truncate">{desc}</p>
      </div>
      <span className="text-[var(--color-dim)] text-[10px]">&rarr;</span>
    </Link>
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); return r.ok ? await r.json() : null } catch { return null }
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const [agents, analytics, credentials, plugins, memory] = await Promise.all([
      fetchJson<{ agents: { status: string }[] }>('/api/agents'),
      fetchJson<{ totalCalls: number; totalTokens: number; totalCostUsd: number; totalErrors: number }>('/api/analytics?days=7'),
      fetchJson<{ providers: { configured: boolean }[] }>('/api/credentials'),
      fetchJson<{ total: number; enabled: number }>('/api/plugins'),
      fetchJson<{ total: number; existing: number }>('/api/memory'),
    ])
    setData({
      agents: {
        total: agents?.agents?.length ?? 0,
        running: agents?.agents?.filter(a => a.status === 'running').length ?? 0,
      },
      analytics: {
        calls: analytics?.totalCalls ?? 0,
        tokens: analytics?.totalTokens ?? 0,
        costUsd: analytics?.totalCostUsd ?? 0,
        errors: analytics?.totalErrors ?? 0,
      },
      credentials: {
        total: credentials?.providers?.length ?? 0,
        configured: credentials?.providers?.filter(p => p.configured).length ?? 0,
      },
      plugins: { total: plugins?.total ?? 0, enabled: plugins?.enabled ?? 0 },
      memory: { total: memory?.total ?? 0, existing: memory?.existing ?? 0 },
    })
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { const iv = setInterval(fetchAll, 15000); return () => clearInterval(iv) }, [fetchAll])

  const SECTIONS = [
    { href: '/agents', title: 'Agenti', desc: 'Lista e dettaglio agenti con log e task', accent: 'var(--color-green)' },
    { href: '/analytics', title: 'Analytics', desc: 'Metriche API — chiamate, token, latenza, costo', accent: 'var(--color-blue)' },
    { href: '/credentials', title: 'Credenziali', desc: 'Gestione API key e token OAuth', accent: 'var(--color-yellow)' },
    { href: '/plugins', title: 'Plugin', desc: 'Attiva/disattiva plugin con toggle', accent: 'var(--color-cyan)' },
    { href: '/memory', title: 'Memory', desc: 'Viewer/editor Soul, Identity, Memory', accent: 'var(--color-magenta)' },
    { href: '/dashboard', title: 'Dashboard', desc: 'Pipeline posizioni e candidature', accent: 'var(--color-green)' },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-[var(--color-green)]" aria-hidden="true" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
          <span className="text-[10px] font-semibold tracking-[0.15em] uppercase text-[var(--color-green)]">sistema attivo</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Job Hunter Team</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Panoramica sistema — agenti, metriche, moduli</p>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse" role="status" aria-live="polite">Caricamento...</p>
      ) : data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
            <StatCard label="Agenti attivi" value={`${data.agents.running}/${data.agents.total}`} color="var(--color-green)" href="/agents" />
            <StatCard label="Chiamate (7g)" value={fmt(data.analytics.calls)} sub={data.analytics.errors > 0 ? `${data.analytics.errors} errori` : undefined} color="var(--color-bright)" href="/analytics" />
            <StatCard label="Token (7g)" value={fmt(data.analytics.tokens)} color="var(--color-blue)" href="/analytics" />
            <StatCard label="Provider" value={`${data.credentials.configured}/${data.credentials.total}`} color="var(--color-yellow)" href="/credentials" />
            <StatCard label="Plugin" value={`${data.plugins.enabled}/${data.plugins.total}`} color="var(--color-cyan)" href="/plugins" />
          </div>

          <div className="mb-6">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Sezioni</p>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
              {SECTIONS.map((s, i) => <div key={s.href} style={{ animation: `fade-in 0.4s ease ${i * 0.06}s both` }}><SectionLink {...s} /></div>)}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">Memory</p>
              <p className="text-[11px] text-[var(--color-muted)]">{data.memory.existing}/{data.memory.total} file bootstrap presenti</p>
            </div>
            <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">Costo stimato (7g)</p>
              <p className="text-[11px] text-[var(--color-muted)]">${data.analytics.costUsd.toFixed(4)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
