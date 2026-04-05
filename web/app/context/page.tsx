'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type SectionPriority = 'required' | 'high' | 'medium' | 'low'
type Section = { id: string; priority: SectionPriority; description: string; estimatedTokens: number }
type ContextData = {
  engine: { id: string; name: string; version: string; status: string }
  budget: { total: number; used: number; available: number; usagePct: number }
  config: { tokenBudget: number; maxHistoryMessages: number; engineId: string; workspace: string }
  stats: { conversations: number; totalMessages: number }
  sections: Section[]
}

const PRIORITY_COLOR: Record<SectionPriority, string> = {
  required: 'var(--color-red)',
  high:     'var(--color-yellow)',
  medium:   'var(--color-green)',
  low:      'var(--color-dim)',
}
const PRIORITY_LABEL: Record<SectionPriority, string> = {
  required: 'obbligatoria', high: 'alta', medium: 'media', low: 'bassa',
}

function TokenBar({ pct }: { pct: number }) {
  const color = pct > 80 ? 'var(--color-red)' : pct > 60 ? 'var(--color-yellow)' : 'var(--color-green)'
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="p-4 rounded-lg border flex flex-col gap-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
      <span className="text-[9px] uppercase tracking-widest text-[var(--color-dim)]">{label}</span>
      <span className="text-xl font-bold text-[var(--color-bright)]">{value}</span>
      {sub && <span className="text-[9px] text-[var(--color-dim)]">{sub}</span>}
    </div>
  )
}

export default function ContextPage() {
  const [data, setData]     = useState<ContextData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/context').then(r => r.ok ? r.json() : null).then(d => { if (d) setData(d) }).finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Context Engine</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Context Engine</h1>
          {data && (
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {data.engine.name} v{data.engine.version} ·{' '}
              <span style={{ color: 'var(--color-green)' }}>{data.engine.status}</span>
            </p>
          )}
        </div>
      </div>

      {loading && <div className="flex justify-center py-16" role="status" aria-live="polite"><span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span></div>}

      {!loading && !data && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="text-4xl">🧠</span>
          <p className="text-[12px] font-semibold text-[var(--color-muted)]">Dati non disponibili</p>
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Budget token" value={data.budget.total.toLocaleString()} />
            <StatCard label="Token usati" value={data.budget.used.toLocaleString()} sub={`${data.budget.usagePct}% del budget`} />
            <StatCard label="Conversazioni" value={data.stats.conversations} />
            <StatCard label="Messaggi totali" value={data.stats.totalMessages} />
          </div>

          {/* Budget bar */}
          <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-[var(--color-muted)]">Utilizzo budget</span>
              <span className="text-[10px] font-mono text-[var(--color-dim)]">{data.budget.used.toLocaleString()} / {data.budget.total.toLocaleString()} token</span>
            </div>
            <TokenBar pct={data.budget.usagePct} />
            <p className="text-[9px] text-[var(--color-dim)] mt-2">{data.budget.available.toLocaleString()} token disponibili</p>
          </div>

          {/* Sezioni */}
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-3">Sezioni contesto</h2>
            <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
              {data.sections.map((sec, i) => (
                <div key={sec.id} className={`flex items-center gap-4 px-5 py-3.5 ${i < data.sections.length - 1 ? 'border-b' : ''}`} style={{ borderColor: 'var(--color-border)' }}>
                  <span className="text-[10px] font-mono font-semibold text-[var(--color-bright)] w-16">{sec.id}</span>
                  <span className="flex-1 text-[10px] text-[var(--color-muted)]">{sec.description}</span>
                  <span className="badge text-[9px] font-mono" style={{ color: PRIORITY_COLOR[sec.priority], border: `1px solid ${PRIORITY_COLOR[sec.priority]}44`, background: `${PRIORITY_COLOR[sec.priority]}0d` }}>
                    {PRIORITY_LABEL[sec.priority]}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--color-dim)] w-20 text-right">{sec.estimatedTokens > 0 ? `~${sec.estimatedTokens} tk` : '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Config */}
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-3">Configurazione</h2>
            <div className="p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
              {Object.entries(data.config).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="text-[10px] font-mono text-[var(--color-dim)] w-40">{k}</span>
                  <span className="text-[10px] font-mono text-[var(--color-bright)]">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
