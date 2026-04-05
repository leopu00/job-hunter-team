'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Hook = { name: string; description: string; source: string; events: string[]; enabled: boolean }

function EventBadge({ event }: { event: string }) {
  const [type, action] = event.split(':')
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono"
      style={{ background: 'rgba(59,130,246,0.08)', color: 'var(--color-blue)', border: '1px solid rgba(59,130,246,0.2)' }}>
      <span className="font-bold">{type}</span>{action && <span className="text-[var(--color-dim)]">:{action}</span>}
    </span>
  )
}

function HookCard({ hook }: { hook: Hook }) {
  return (
    <div className="flex items-start gap-4 px-5 py-4 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex-shrink-0 mt-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: hook.enabled ? 'var(--color-green)' : 'var(--color-dim)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[12px] font-semibold font-mono text-[var(--color-bright)]">{hook.name}</span>
          <span className="badge text-[8px]" style={{ color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{hook.source}</span>
          <span className="badge text-[8px]" style={{
            color: hook.enabled ? 'var(--color-green)' : 'var(--color-dim)',
            background: hook.enabled ? 'rgba(0,200,83,0.08)' : 'transparent',
            border: `1px solid ${hook.enabled ? 'rgba(0,200,83,0.3)' : 'var(--color-border)'}`,
          }}>{hook.enabled ? 'attivo' : 'disattivo'}</span>
        </div>
        {hook.description && <p className="text-[10px] text-[var(--color-muted)] mb-1.5">{hook.description}</p>}
        <div className="flex flex-wrap gap-1">
          {hook.events.map(e => <EventBadge key={e} event={e} />)}
          {hook.events.length === 0 && <span className="text-[9px] text-[var(--color-dim)]">nessun evento</span>}
        </div>
      </div>
    </div>
  )
}

export default function HooksPage() {
  const [hooks, setHooks] = useState<Hook[]>([])
  const [total, setTotal] = useState(0)
  const [hooksDir, setHooksDir] = useState('')
  const [error, setError] = useState('')

  const fetchHooks = useCallback(async () => {
    const res = await fetch('/api/hooks').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setHooks(data.hooks ?? [])
    setTotal(data.total ?? 0)
    setHooksDir(data.hooksDir ?? '')
    setError(data.error ?? '')
  }, [])

  useEffect(() => { fetchHooks() }, [fetchHooks])

  const activeCount = hooks.filter(h => h.enabled).length
  const totalEvents = hooks.reduce((s, h) => s + h.events.length, 0)

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Hooks</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Hooks</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {activeCount}/{total} attivi · {totalEvents} eventi registrati
          {hooksDir && <span className="ml-2 font-mono text-[var(--color-dim)]">{hooksDir}</span>}
        </p>
        {error && <p className="text-[10px] text-[var(--color-yellow)] mt-1" role="alert">{error}</p>}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {hooks.length === 0
          ? <div className="py-16 text-center">
              <p className="text-[var(--color-dim)] text-[12px]">Nessun hook trovato.</p>
              <p className="text-[var(--color-dim)] text-[10px] mt-1">Crea una cartella hooks/ nel workspace con HOOK.md e handler.ts</p>
            </div>
          : hooks.map(h => <HookCard key={h.name} hook={h} />)
        }
      </div>
    </div>
  )
}
