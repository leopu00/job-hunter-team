import Link from 'next/link'
import { getScoutStats } from '@/lib/queries'
import ScoutLiveSection from './_components/ScoutLiveSection'

export default async function ScoutPage() {
  const stats = await getScoutStats()
  const total = stats.reduce((a, s) => a + s.total, 0)

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Scout</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Scout</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            Posizioni trovate per agente · {total} totali
          </p>
        </div>
      </div>

      {/* ── Totale KPI ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {[
          { label: 'Posizioni totali', val: total, color: 'var(--color-blue)' },
          { label: 'Scout attivi', val: stats.length, color: 'var(--color-purple)' },
          { label: 'Inviate', val: stats.reduce((a, s) => a + s.applied, 0), color: 'var(--color-green)' },
          { label: 'Risposte', val: stats.reduce((a, s) => a + s.responded, 0), color: '#58a6ff' },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>{label}</div>
            <div className="text-3xl font-bold tracking-tight leading-none" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── Per agente ───────────────────────────────────────────── */}
      <div className="section-label mb-4">Attività per Scout</div>
      {stats.length === 0 ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-8 text-center text-[var(--color-dim)] text-[11px]">
          Nessuna attività registrata.
        </div>
      ) : (
      <div className="space-y-4">
        {stats.map((s, i) => {
          const colors = ['var(--color-blue)', 'var(--color-purple)', 'var(--color-green)', 'var(--color-yellow)']
          const color = colors[i % colors.length]
          const pctApplied = s.total > 0 ? ((s.applied / s.total) * 100).toFixed(1) : '0'
          const pctResponded = s.applied > 0 ? ((s.responded / s.applied) * 100).toFixed(1) : '0'
          return (
            <div key={s.scout} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-[13px] font-bold" style={{ color }}>{s.scout}</span>
                  <span className="text-[10px] text-[var(--color-dim)] ml-2">{s.total} posizioni</span>
                </div>
                <div className="text-[10px] text-[var(--color-dim)]">
                  {pctApplied}% inviate · {pctResponded}% risposta
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Totale', val: s.total, c: color },
                  { label: 'Attive', val: s.active, c: 'var(--color-muted)' },
                  { label: 'Escluse', val: s.excluded, c: 'var(--color-red)' },
                  { label: 'Inviate', val: s.applied, c: 'var(--color-green)' },
                ].map(({ label, val, c }) => (
                  <div key={label} className="text-center">
                    <div className="text-[9px] font-semibold tracking-widest uppercase mb-1" style={{ color: 'var(--color-dim)' }}>{label}</div>
                    <div className="text-2xl font-bold" style={{ color: c }}>{val}</div>
                  </div>
                ))}
              </div>
              {/* Bar: inviate */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-[var(--color-dim)] w-14 text-right shrink-0">inviate</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pctApplied}%`, background: color, opacity: 0.8 }} />
                </div>
                <span className="text-[10px] font-semibold w-10 shrink-0" style={{ color }}>{pctApplied}%</span>
              </div>
            </div>
          )
        })}
      </div>
      )}

      <ScoutLiveSection />

    </div>
  )
}
