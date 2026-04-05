import Link from 'next/link'
import { getScorerStats } from '@/lib/queries'
import ScorerLiveSection from './_components/ScorerLiveSection'
import AgentInteraction from '@/components/AgentInteraction'

export default async function ScorerPage() {
  const stats = await getScorerStats()
  const total = stats.reduce((a, s) => a + s.total, 0)
  const globalAvg = total > 0
    ? Math.round(stats.reduce((a, s) => a + s.avgScore * s.total, 0) / total)
    : 0

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Scorer</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Scorer</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            Score per agente · {total} totali · avg globale {globalAvg}
          </p>
        </div>
      </div>

      {/* ── Totale KPI ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10" style={{ animation: 'fade-in 0.35s ease both' }}>
        {[
          { label: 'Posizioni scored', val: total, color: 'var(--color-purple)' },
          { label: 'Score medio', val: globalAvg, color: globalAvg >= 70 ? 'var(--color-green)' : globalAvg >= 40 ? 'var(--color-yellow)' : 'var(--color-orange)' },
          { label: 'Alta (≥70)', val: stats.reduce((a, s) => a + s.high, 0), color: 'var(--color-green)' },
          { label: 'Bassa (<40)', val: stats.reduce((a, s) => a + s.low, 0), color: 'var(--color-red)' },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>{label}</div>
            <div className="text-3xl font-bold tracking-tight leading-none" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── Per agente ───────────────────────────────────────────── */}
      <div className="section-label mb-4" style={{ animation: 'fade-in 0.35s ease 0.05s both' }}>Attività per Scorer</div>
      {stats.length === 0 ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-8 text-center text-[var(--color-dim)] text-[11px]">
          Nessuna attività registrata.
        </div>
      ) : (
      <div className="space-y-4">
        {stats.map((s, i) => {
          const colors = ['var(--color-purple)', 'var(--color-blue)', 'var(--color-yellow)']
          const color = colors[i % colors.length]
          const avgColor = s.avgScore >= 70 ? 'var(--color-green)' : s.avgScore >= 40 ? 'var(--color-yellow)' : 'var(--color-orange)'
          return (
            <div key={s.scorer} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-[13px] font-bold" style={{ color }}>{s.scorer}</span>
                  <span className="text-[10px] text-[var(--color-dim)] ml-2">{s.total} score</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9.5px] text-[var(--color-dim)]">avg</span>
                  <span className="text-[18px] font-bold" style={{ color: avgColor }}>{s.avgScore}</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Alta ≥70', val: s.high, c: 'var(--color-green)' },
                  { label: 'Media 40-69', val: s.mid, c: 'var(--color-yellow)' },
                  { label: 'Bassa <40', val: s.low, c: 'var(--color-red)' },
                ].map(({ label, val, c }) => (
                  <div key={label} className="text-center">
                    <div className="text-[9px] font-semibold tracking-widest uppercase mb-1" style={{ color: 'var(--color-dim)' }}>{label}</div>
                    <div className="text-2xl font-bold" style={{ color: c }}>{val}</div>
                    {s.total > 0 && (
                      <div className="text-[10px] text-[var(--color-dim)] mt-0.5">{((val / s.total) * 100).toFixed(0)}%</div>
                    )}
                  </div>
                ))}
              </div>
              {/* Avg score bar */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-[var(--color-dim)] w-14 text-right shrink-0">score avg</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <div className="h-full rounded-full" style={{ width: `${s.avgScore}%`, background: avgColor, opacity: 0.85 }} />
                </div>
                <span className="text-[10px] font-semibold w-10 shrink-0" style={{ color: avgColor }}>{s.avgScore}</span>
              </div>
            </div>
          )
        })}
      </div>
      )}

      <ScorerLiveSection />

      <AgentInteraction sessionPrefix="SCORER" color="#b388ff" label="Scorer" />

    </div>
  )
}
