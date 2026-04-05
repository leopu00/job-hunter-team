'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type ToolInfo = { id: string; label: string; description: string; sectionId: string; profiles: string[]; enabled: boolean }
type ToolExec = { ts: number; toolId: string; status: 'ok' | 'error'; durationMs: number; error?: string }
type Section = { id: string; label: string; tools: ToolInfo[] }
type Data = { tools: ToolInfo[]; sections: Section[]; executions: ToolExec[]; total: number; enabled: number; execCount: number }

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

function ToolRow({ t, onToggle, toggling }: { t: ToolInfo; onToggle: (id: string, enabled: boolean) => void; toggling: string | null }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-[var(--color-bright)]">{t.label}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.04)] text-[var(--color-dim)] font-mono">{t.id}</span>
        </div>
        <p className="text-[10px] text-[var(--color-dim)] mt-0.5">{t.description}</p>
      </div>
      <Toggle enabled={t.enabled} onChange={() => onToggle(t.id, !t.enabled)} loading={toggling === t.id} />
    </div>
  )
}

function ExecRow({ e }: { e: ToolExec }) {
  const time = new Date(e.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const ok = e.status === 'ok'
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] text-[10px] hover:bg-[var(--color-row)]">
      <span className="text-[var(--color-dim)] w-16 shrink-0">{time}</span>
      <span className="font-semibold text-[var(--color-bright)] w-24">{e.toolId}</span>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ok ? 'var(--color-green)' : 'var(--color-red)' }} />
      <span className="text-[var(--color-muted)]">{e.durationMs}ms</span>
      {e.error && <span className="text-[var(--color-red)] truncate flex-1">{e.error}</span>}
    </div>
  )
}

export default function ToolsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [tab, setTab] = useState<'tools' | 'log'>('tools')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/tools').catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleToggle(id: string, enabled: boolean) {
    setToggling(id)
    await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) }).catch(() => null)
    await fetchData()
    setToggling(null)
  }

  const TABS = [
    { v: 'tools' as const, l: 'Tool', count: data?.total },
    { v: 'log' as const, l: 'Log esecuzioni', count: data?.execCount },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Tool</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Tool</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{data ? `${data.enabled}/${data.total} attivi` : 'Caricamento...'}</p>
          </div>
          <div className="flex gap-1">
            {TABS.map(t => (
              <button key={t.v} onClick={() => setTab(t.v)}
                className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
                style={{ background: tab === t.v ? 'var(--color-row)' : 'transparent', color: tab === t.v ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${tab === t.v ? 'var(--color-border-glow)' : 'transparent'}` }}>
                {t.l}{t.count != null ? ` (${t.count})` : ''}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse">Caricamento...</p>
      ) : !data ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Errore nel caricamento.</p>
      ) : tab === 'tools' ? (
        <div className="space-y-4">
          {data.sections.map(s => (
            <div key={s.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)]">{s.label}</p>
              </div>
              {s.tools.map(t => <ToolRow key={t.id} t={t} onToggle={handleToggle} toggling={toggling} />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)]">Esecuzioni recenti</p>
          </div>
          {data.executions.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto">
              {[...data.executions].reverse().map((e, i) => <ExecRow key={i} e={e} />)}
            </div>
          ) : (
            <p className="text-[var(--color-dim)] text-[11px] text-center py-12">Nessuna esecuzione registrata. Esegui un tool per vederne i risultati qui.</p>
          )}
        </div>
      )}
    </div>
  )
}
