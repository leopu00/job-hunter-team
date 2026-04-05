import Link from 'next/link'
import { getDashboardStats, getApplicationStats, getScoreDistribution, getSourceDistribution, getRisposteCount } from '@/lib/queries'

const POS_PIPELINE = [
  { key: 'new',      label: 'New',       color: 'var(--color-muted)' },
  { key: 'checked',  label: 'Checked',   color: 'var(--color-blue)' },
  { key: 'scored',   label: 'Scored',    color: 'var(--color-purple)' },
  { key: 'writing',  label: 'Writing',   color: 'var(--color-yellow)' },
  { key: 'review',   label: 'Review',    color: 'var(--color-orange)' },
  { key: 'ready',    label: 'Ready',     color: '#7fffb2' },
  { key: 'applied',  label: 'Applied',   color: 'var(--color-green)' },
  { key: 'response', label: 'Response',  color: '#58a6ff' },
  { key: 'excluded', label: 'Excluded',  color: 'var(--color-red)' },
]

const APP_PIPELINE = [
  { key: 'draft',    label: 'Draft',    color: 'var(--color-dim)' },
  { key: 'review',   label: 'Review',   color: 'var(--color-orange)' },
  { key: 'ready',    label: 'Ready',    color: '#7fffb2' },
  { key: 'applied',  label: 'Applied',  color: 'var(--color-green)' },
  { key: 'response', label: 'Response', color: '#58a6ff' },
]

export default async function CrescitaPage() {
  const [posStats, appStats, scoreDist, sourceDist, risposteCount] = await Promise.all([
    getDashboardStats(),
    getApplicationStats(),
    getScoreDistribution(),
    getSourceDistribution(),
    getRisposteCount(),
  ])

  const posTotal = posStats.total
  const appTotal = appStats['_total'] ?? 0
  const appSent  = appStats['_sent'] ?? 0

  // Conversion rates (usa risposteCount per avere lo stesso conteggio di /risposte)
  const rateApplied   = posTotal > 0 ? ((posStats.applied / posTotal) * 100).toFixed(1) : '0'
  const rateResponded = posStats.applied > 0 ? ((risposteCount / posStats.applied) * 100).toFixed(1) : '0'

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Crescita</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Crescita & Analytics</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            Progressione pipeline · tassi di conversione · distribuzione candidature
          </p>
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────── */}
      <div className="section-label mb-4">KPI Chiave</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {[
          { label: 'Posizioni trovate', val: posTotal, color: 'var(--color-blue)' },
          { label: 'Candidature create', val: appTotal, color: 'var(--color-purple)' },
          { label: 'CV inviati', val: appSent, color: 'var(--color-green)' },
          { label: 'Risposte ricevute', val: risposteCount, color: '#58a6ff' },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>{label}</div>
            <div className="text-3xl font-bold tracking-tight leading-none" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* ── Conversion rates ─────────────────────────────────────── */}
      <div className="section-label mb-4">Tassi di conversione</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        <ConversionCard
          label="Trovate → Inviate"
          numerator={posStats.applied}
          denominator={posTotal}
          rate={rateApplied}
          color="var(--color-green)"
          description={`${posStats.applied} inviate su ${posTotal} trovate`}
        />
        <ConversionCard
          label="Inviate → Risposta"
          numerator={risposteCount}
          denominator={posStats.applied}
          rate={rateResponded}
          color="#58a6ff"
          description={`${risposteCount} risposte su ${posStats.applied} inviate`}
        />
      </div>

      {/* ── Pipeline posizioni ───────────────────────────────────── */}
      <div className="section-label mb-4">Pipeline Posizioni — {posTotal} totali</div>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 mb-10">
        <div className="space-y-3">
          {POS_PIPELINE.map(step => {
            const count = (posStats as any)[step.key] ?? 0
            const pct = posTotal > 0 ? (count / posTotal) * 100 : 0
            return (
              <div key={step.key} className="flex items-center gap-3">
                <div className="w-16 text-[9.5px] font-semibold tracking-widest uppercase text-right shrink-0" style={{ color: step.color }}>
                  {step.label}
                </div>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: step.color, opacity: 0.85 }} />
                </div>
                <div className="w-20 flex items-center gap-1.5 shrink-0">
                  <span className="text-[12px] font-bold" style={{ color: step.color }}>{count}</span>
                  <span className="text-[10px] text-[var(--color-dim)]">{pct.toFixed(0)}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Pipeline candidature ─────────────────────────────────── */}
      <div className="section-label mb-4">Pipeline Candidature — {appTotal} totali</div>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 mb-8">
        <div className="space-y-3">
          {APP_PIPELINE.map(step => {
            const count = appStats[step.key] ?? 0
            const pct = appTotal > 0 ? (count / appTotal) * 100 : 0
            return (
              <div key={step.key} className="flex items-center gap-3">
                <div className="w-16 text-[9.5px] font-semibold tracking-widest uppercase text-right shrink-0" style={{ color: step.color }}>
                  {step.label}
                </div>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: step.color, opacity: 0.85 }} />
                </div>
                <div className="w-20 flex items-center gap-1.5 shrink-0">
                  <span className="text-[12px] font-bold" style={{ color: step.color }}>{count}</span>
                  <span className="text-[10px] text-[var(--color-dim)]">{pct.toFixed(0)}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Tier breakdown (Seria / Practice / Riferimento) ────────── */}
      <div className="section-label mb-4">Tier — Distribuzione Score</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Seria',        desc: 'score ≥ 70', count: (scoreDist.buckets.find(b => b.label === '76–100')?.count ?? 0) + (scoreDist.buckets.find(b => b.label === '61–75')?.count ?? 0), color: 'var(--color-green)', href: '/positions?tier=seria' },
          { label: 'Practice',     desc: 'score 40–69', count: scoreDist.buckets.find(b => b.label === '41–60')?.count ?? 0, color: 'var(--color-yellow)', href: '/positions?tier=practice' },
          { label: 'Riferimento',  desc: 'score < 40', count: scoreDist.buckets.find(b => b.label === '≤ 40')?.count ?? 0, color: 'var(--color-orange)', href: '/positions?tier=riferimento' },
          { label: 'Non scored',   desc: 'nessun score', count: scoreDist.total - scoreDist.withScore, color: 'var(--color-dim)', href: '/positions?tier=noscore' },
        ].map(({ label, desc, count, color, href }) => (
          <a
            key={label}
            href={href}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors no-underline"
          >
            <div className="text-[9px] font-semibold tracking-[0.14em] uppercase mb-1" style={{ color }}>{label}</div>
            <div className="text-3xl font-bold leading-none mb-1" style={{ color }}>{count}</div>
            <div className="text-[10px] text-[var(--color-dim)]">{desc}</div>
            {scoreDist.total > 0 && (
              <div className="h-1 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--color-border)' }}>
                <div className="h-full rounded-full" style={{ width: `${(count / scoreDist.total) * 100}%`, background: color, opacity: 0.7 }} />
              </div>
            )}
          </a>
        ))}
      </div>

      {/* ── Distribuzione per fonte ──────────────────────────────── */}
      {sourceDist.length > 0 && (
        <>
          <div className="section-label mb-4">Fonti — Top {sourceDist.length}</div>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 mb-8">
            <div className="space-y-3">
              {(() => {
                const max = sourceDist[0]?.count ?? 1
                return sourceDist.map(s => (
                  <div key={s.source} className="flex items-center gap-3">
                    <div className="w-32 text-[9.5px] font-semibold text-right shrink-0 text-[var(--color-muted)] truncate" title={s.source}>{s.source}</div>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(s.count / max) * 100}%`, background: 'var(--color-blue)', opacity: 0.8 }} />
                    </div>
                    <div className="w-14 flex items-center gap-1.5 shrink-0">
                      <span className="text-[12px] font-bold text-[var(--color-blue)]">{s.count}</span>
                      <span className="text-[10px] text-[var(--color-dim)]">{scoreDist.total > 0 ? ((s.count / scoreDist.total) * 100).toFixed(0) : 0}%</span>
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </>
      )}

      {/* ── Score medio ──────────────────────────────────────────── */}
      {scoreDist.avgScore != null && (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 mb-8 flex items-center gap-6">
          <div>
            <div className="text-[9.5px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-1">Score medio</div>
            <div
              className="text-5xl font-bold tracking-tight"
              style={{ color: scoreDist.avgScore >= 70 ? 'var(--color-green)' : scoreDist.avgScore >= 40 ? 'var(--color-yellow)' : 'var(--color-orange)' }}
            >
              {scoreDist.avgScore}
            </div>
          </div>
          <div className="flex-1">
            <div className="text-[10px] text-[var(--color-dim)] mb-1">{scoreDist.withScore} posizioni con score su {scoreDist.total} totali</div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${scoreDist.avgScore}%`,
                  background: scoreDist.avgScore >= 70 ? 'var(--color-green)' : scoreDist.avgScore >= 40 ? 'var(--color-yellow)' : 'var(--color-orange)',
                }}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function ConversionCard({
  label, numerator, denominator, rate, color, description,
}: {
  label: string
  numerator: number
  denominator: number
  rate: string
  color: string
  description: string
}) {
  const pct = denominator > 0 ? (numerator / denominator) * 100 : 0

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
      <div className="text-[9.5px] font-semibold tracking-widest uppercase mb-3" style={{ color: 'var(--color-dim)' }}>{label}</div>
      <div className="text-4xl font-bold tracking-tight mb-3" style={{ color }}>{rate}%</div>
      <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'var(--color-border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[10px] text-[var(--color-dim)]">{description}</div>
    </div>
  )
}
