'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type PluginInfo = {
  id: string; name: string; version: string; description: string
  kind: string | string[]; enabled: boolean; enabledByDefault: boolean
  envVars: string[]; dependencies: string[]
}
type PluginList = { plugins: PluginInfo[]; total: number; enabled: number }

const KIND_COLORS: Record<string, string> = {
  skill: 'var(--color-blue)', channel: 'var(--color-green)', storage: 'var(--color-yellow)',
  provider: 'var(--color-cyan)', tool: 'var(--color-muted)', integration: 'var(--color-magenta)',
}

function KindBadge({ kind }: { kind: string }) {
  const color = KIND_COLORS[kind] ?? 'var(--color-dim)'
  return <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ background: `${color}22`, color }}>{kind}</span>
}

function Toggle({ enabled, onChange, loading }: { enabled: boolean; onChange: () => void; loading: boolean }) {
  return (
    <button onClick={onChange} disabled={loading}
      className="relative w-9 h-5 rounded-full cursor-pointer transition-colors disabled:opacity-40"
      style={{ background: enabled ? 'var(--color-green)' : 'var(--color-border)' }}>
      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
        style={{ transform: enabled ? 'translateX(16px)' : 'translateX(0)' }} />
    </button>
  )
}

function PluginCard({ p, onToggle, toggling }: { p: PluginInfo; onToggle: (id: string, enabled: boolean) => void; toggling: string | null }) {
  const kinds = Array.isArray(p.kind) ? p.kind : [p.kind]
  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[12px] font-semibold text-[var(--color-bright)]">{p.name}</span>
            <span className="text-[9px] text-[var(--color-dim)]">v{p.version}</span>
            {kinds.map(k => <KindBadge key={k} kind={k} />)}
          </div>
          {p.description && <p className="text-[10px] text-[var(--color-muted)] truncate">{p.description}</p>}
          {(p.dependencies.length > 0 || p.envVars.length > 0) && (
            <div className="flex gap-3 mt-1">
              {p.dependencies.length > 0 && (
                <span className="text-[9px] text-[var(--color-dim)]">Dipendenze: {p.dependencies.join(', ')}</span>
              )}
              {p.envVars.length > 0 && (
                <span className="text-[9px] text-[var(--color-dim)]">Env: {p.envVars.join(', ')}</span>
              )}
            </div>
          )}
        </div>
        <Toggle enabled={p.enabled} onChange={() => onToggle(p.id, !p.enabled)} loading={toggling === p.id} />
      </div>
    </div>
  )
}

export default function PluginsPage() {
  const [data, setData] = useState<PluginList | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'disabled'>('all')

  const fetchPlugins = useCallback(async () => {
    const res = await fetch('/api/plugins').catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchPlugins() }, [fetchPlugins])

  async function handleToggle(id: string, enabled: boolean) {
    setToggling(id)
    const res = await fetch('/api/plugins', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    }).catch(() => null)
    if (res?.ok) await fetchPlugins()
    setToggling(null)
  }

  const filtered = data?.plugins.filter(p => {
    if (filter === 'active') return p.enabled
    if (filter === 'disabled') return !p.enabled
    return true
  }) ?? []

  const FILTERS = [
    { v: 'all' as const, l: 'Tutti' },
    { v: 'active' as const, l: 'Attivi' },
    { v: 'disabled' as const, l: 'Disabilitati' },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Plugin</span>
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Plugin</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {data ? `${data.enabled}/${data.total} attivi` : 'Caricamento...'}
            </p>
          </div>
          <div className="flex gap-1">
            {FILTERS.map(f => (
              <button key={f.v} onClick={() => setFilter(f.v)}
                className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
                style={{ background: filter === f.v ? 'var(--color-row)' : 'transparent', color: filter === f.v ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f.v ? 'var(--color-border-glow)' : 'transparent'}` }}>
                {f.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse">Caricamento...</p>
      ) : !data || data.total === 0 ? (
        <div className="text-center py-16">
          <p className="text-[var(--color-dim)] text-[12px]">Nessun plugin trovato.</p>
          <p className="text-[var(--color-dim)] text-[10px] mt-2">I plugin vanno in <code className="text-[var(--color-muted)]">~/.jht/plugins/</code> con un file <code className="text-[var(--color-muted)]">jht.plugin.json</code></p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Nessun plugin per il filtro selezionato.</p>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)]">Plugin installati</p>
            <p className="text-[10px] text-[var(--color-dim)]">{filtered.length} mostrati</p>
          </div>
          {filtered.map(p => <PluginCard key={p.id} p={p} onToggle={handleToggle} toggling={toggling} />)}
        </div>
      )}
    </div>
  )
}
