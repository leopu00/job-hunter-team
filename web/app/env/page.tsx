'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type EnvSource   = 'env' | 'config' | 'secret'
type EnvCategory = 'AI Provider' | 'Telegram' | 'Database' | 'Sistema' | 'Config' | 'Secrets'
type EnvVar      = { name: string; source: EnvSource; category: EnvCategory; set: boolean }
type EnvRes      = { vars: EnvVar[]; total: number; setCount: number; unsetCount: number }

const SOURCE_COLOR: Record<EnvSource, string> = {
  env:    'var(--color-green)',
  config: 'var(--color-yellow)',
  secret: 'var(--color-orange)',
}
const SOURCE_LABEL: Record<EnvSource, string> = {
  env: 'env', config: 'config', secret: 'secret',
}

function groupByCategory(vars: EnvVar[]): Record<string, EnvVar[]> {
  const out: Record<string, EnvVar[]> = {}
  for (const v of vars) {
    if (!out[v.category]) out[v.category] = []
    out[v.category]!.push(v)
  }
  return out
}

export default function EnvPage() {
  const [data, setData]       = useState<EnvRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [filter, setFilter]   = useState<'all' | 'set' | 'unset'>('all')

  useEffect(() => {
    fetch('/api/env').then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d) }).finally(() => setLoading(false))
  }, [])

  const toggleReveal = (name: string) => {
    setRevealed(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const filtered = data?.vars.filter(v => filter === 'all' ? true : filter === 'set' ? v.set : !v.set) ?? []
  const groups = groupByCategory(filtered)

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Variabili d&apos;ambiente</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Variabili d&apos;ambiente</h1>
          {data && <p className="text-[var(--color-muted)] text-[11px] mt-1">{data.setCount} impostate · {data.unsetCount} mancanti · {data.total} totali</p>}
        </div>
        <div className="flex gap-1.5 mt-4">
          {(['all','set','unset'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
              style={{ border: `1px solid ${filter === f ? 'var(--color-green)' : 'var(--color-border)'}`, color: filter === f ? 'var(--color-green)' : 'var(--color-dim)', background: filter === f ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
              {f === 'all' ? 'tutte' : f === 'set' ? 'impostate' : 'mancanti'}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span></div>}

      {!loading && data && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="text-4xl" aria-hidden="true">🌿</span>
          <p className="text-[12px] font-semibold text-[var(--color-muted)]">Nessuna variabile trovata</p>
        </div>
      )}

      {!loading && data && filtered.length > 0 && (
        <div className="flex flex-col gap-5">
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat}>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-2">{cat}</h3>
              <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
                {items.map((v, i) => (
                  <div key={v.name} className={`flex items-center gap-3 px-5 py-3 ${i < items.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0`} style={{ background: v.set ? 'var(--color-green)' : 'var(--color-border)' }} />
                    <span className="text-[11px] font-mono text-[var(--color-bright)] flex-1 truncate">{v.name}</span>
                    <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--color-dim)', minWidth: 120, textAlign: 'right' }}>
                      {v.set
                        ? (revealed.has(v.name) ? <span style={{ color: 'var(--color-muted)' }}>{'•'.repeat(16)}</span> : '●●●●●●●●●●●●●●●●')
                        : <span style={{ color: 'var(--color-red)', fontSize: 9 }}>non impostata</span>
                      }
                    </span>
                    <span className="badge text-[9px] flex-shrink-0" style={{ color: SOURCE_COLOR[v.source], border: `1px solid ${SOURCE_COLOR[v.source]}33`, background: `${SOURCE_COLOR[v.source]}0d` }}>
                      {SOURCE_LABEL[v.source]}
                    </span>
                    {v.set && (
                      <button onClick={() => toggleReveal(v.name)} className="px-2 py-1 rounded text-[9px] cursor-pointer flex-shrink-0 transition-colors"
                        style={{ border: '1px solid var(--color-border)', color: revealed.has(v.name) ? 'var(--color-green)' : 'var(--color-dim)', background: 'transparent' }}>
                        {revealed.has(v.name) ? '🙈' : '👁'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[9px] text-[var(--color-dim)] text-center pb-2">I valori non vengono mai trasmessi. Reveal mostra solo che la variabile è impostata.</p>
        </div>
      )}
    </div>
  )
}
