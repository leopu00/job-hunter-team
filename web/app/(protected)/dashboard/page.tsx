import Link from 'next/link'
import { getDashboardStats, getRecentPositions, getScoreDistribution, getSourceDistribution } from '@/lib/queries'
import { getWorkspacePath, isSupabaseConfigured } from '@/lib/workspace'
import { readWorkspaceProfile } from '@/lib/profile-reader'
import { runBash } from '@/lib/shell'
import type { PositionWithScore } from '@/lib/types'
import OnboardingWizard from '@/app/components/OnboardingWizard'

const STATUS_COLORS: Record<string, string> = {
  new:      'var(--color-muted)',
  checked:  'var(--color-blue)',
  scored:   'var(--color-purple)',
  writing:  'var(--color-yellow)',
  review:   'var(--color-orange)',
  ready:    '#7fffb2',
  applied:  'var(--color-green)',
  response: '#58a6ff',
  excluded: 'var(--color-red)',
}

function scoreClass(s?: number) {
  if (!s) return 'text-[var(--color-dim)]'
  if (s >= 75) return 'text-[var(--color-green)]'
  if (s >= 55) return 'text-[var(--color-yellow)]'
  return 'text-[var(--color-red)]'
}

function scoreBg(s?: number) {
  if (!s) return 'var(--color-border)'
  if (s >= 75) return 'var(--color-green)'
  if (s >= 55) return 'var(--color-yellow)'
  return 'var(--color-red)'
}

export default async function DashboardPage() {
  const [stats, positions, scoreDist, sourceDist] = await Promise.all([
    getDashboardStats(),
    getRecentPositions(15),
    getScoreDistribution(),
    getSourceDistribution(),
  ])

  const activeTotal = stats.total - stats.excluded

  // Check if profile exists for onboarding status
  let hasProfile = false
  if (isSupabaseConfigured) {
    // Cloud mode: check via supabase (profile page handles this)
    hasProfile = false // will be refined when supabase profile check is available
  } else {
    const workspace = await getWorkspacePath()
    if (workspace) {
      hasProfile = readWorkspaceProfile(workspace) !== null
    }
  }

  // Verifica se il team è attivo (sessioni tmux JHT)
  let teamActive = false
  try {
    const { stdout } = await runBash('tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""')
    const sessions = stdout.trim().split('\n').filter(Boolean)
    const JH_PREFIXES = ['ALFA', 'SCOUT', 'ANALISTA', 'SCORER', 'SCRITTORE', 'CRITICO', 'SENTINELLA']
    teamActive = sessions.some(s =>
      JH_PREFIXES.some(p => s.toUpperCase() === p || s.toUpperCase().startsWith(`${p}-`))
    )
  } catch {}

  const isEmpty = stats.total === 0

  const pipeline = [
    { key: 'new',     label: 'New',     count: stats.new,     color: STATUS_COLORS.new },
    { key: 'checked', label: 'Checked', count: stats.checked, color: STATUS_COLORS.checked },
    { key: 'scored',  label: 'Scored',  count: stats.scored,  color: STATUS_COLORS.scored },
    { key: 'writing', label: 'Writing', count: stats.writing, color: STATUS_COLORS.writing },
    { key: 'review',  label: 'Review',  count: stats.review,  color: STATUS_COLORS.review },
    { key: 'ready',   label: 'Ready',   count: stats.ready,   color: STATUS_COLORS.ready },
    { key: 'applied', label: 'Applied', count: stats.applied, color: STATUS_COLORS.applied },
  ]

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              background: teamActive ? 'var(--color-green)' : 'var(--color-dim)',
              animation: teamActive ? 'pulse-dot 2s ease-in-out infinite' : undefined,
            }}
          />
          <span
            className="text-[10px] font-semibold tracking-[0.18em] uppercase"
            style={{ color: teamActive ? 'var(--color-green)' : 'var(--color-dim)' }}
          >
            {teamActive ? 'live · team attivo' : 'dati aggiornati'}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          Dashboard
        </h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {stats.total} posizioni totali · {stats.excluded} escluse · {activeTotal} attive
        </p>
      </div>

      {/* ── Onboarding (empty state) ──────────────────────────── */}
      {isEmpty && (
        <div className="mb-10">
          <div className="section-label mb-5">Inizia da qui</div>
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 mb-6">
            <p className="text-[var(--color-muted)] text-[12px] mb-6 leading-relaxed">
              Configura il tuo profilo per avviare la ricerca.
            </p>

            <div className="flex flex-col gap-4">

              {/* Step 1 — Configura il Profilo (obbligatorio) */}
              <Link
                href="/profile"
                className={`group flex items-start gap-4 p-4 rounded-lg border bg-[var(--color-panel)] no-underline transition-colors ${
                  hasProfile
                    ? 'border-[var(--color-green)]/30'
                    : 'border-[var(--color-border)] hover:border-[#00e87a55]'
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full border text-[13px] font-bold shrink-0 mt-0.5 ${
                    hasProfile
                      ? 'border-[var(--color-green)] text-[var(--color-green)] bg-[var(--color-green)]/10'
                      : 'border-[var(--color-green)] text-[var(--color-green)]'
                  }`}
                >
                  {hasProfile ? '✓' : '1'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] font-bold mb-1 ${hasProfile ? 'text-[var(--color-green)]' : 'text-[var(--color-bright)] group-hover:text-[var(--color-green)] transition-colors'}`}>
                    Configura il tuo Profilo
                    {hasProfile && (
                      <span className="ml-2 text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--color-green)] bg-[var(--color-green)]/10 px-2 py-0.5 rounded-full border border-[var(--color-green)]/20">
                        completato
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0">
                    {hasProfile
                      ? 'Il profilo è stato configurato. Il team userà queste informazioni per personalizzare la ricerca.'
                      : 'Ruolo target, skills, preferenze e salary range. Il team userà queste informazioni per la ricerca.'
                    }
                  </p>
                </div>
                {!hasProfile && (
                  <span className="text-[var(--color-dim)] group-hover:text-[var(--color-green)] text-[14px] transition-colors shrink-0 mt-1">
                    →
                  </span>
                )}
              </Link>

              {/* Step 2 — Avvia il Team */}
              <Link
                href="/team"
                className={`group flex items-start gap-4 p-4 rounded-lg border bg-[var(--color-panel)] no-underline transition-colors ${
                  hasProfile
                    ? 'border-[var(--color-border)] hover:border-[#ffc10755]'
                    : 'border-[var(--color-border)] opacity-50 pointer-events-none'
                }`}
              >
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full border text-[13px] font-bold shrink-0 mt-0.5 ${
                    hasProfile
                      ? 'border-[var(--color-yellow)] text-[var(--color-yellow)]'
                      : 'border-[var(--color-dim)] text-[var(--color-dim)]'
                  }`}
                >
                  2
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[12px] font-bold mb-1 ${hasProfile ? 'text-[var(--color-bright)] group-hover:text-[var(--color-yellow)]' : 'text-[var(--color-dim)]'} transition-colors`}>
                    Avvia il Team
                  </div>
                  <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0">
                    {hasProfile
                      ? 'Il profilo è pronto. Avvia il team di agenti per iniziare la ricerca automatizzata di posizioni lavorative.'
                      : 'Prima configura il profilo. Il team ha bisogno delle tue informazioni per cercare posizioni aderenti.'
                    }
                  </p>
                </div>
                {hasProfile && (
                  <span className="text-[var(--color-dim)] group-hover:text-[var(--color-yellow)] text-[14px] transition-colors shrink-0 mt-1">
                    →
                  </span>
                )}
              </Link>

            </div>

            {/* Assistente — helper opzionale, fuori dal flusso obbligatorio */}
            <div className="mt-5 pt-4 border-t border-[var(--color-border)]">
              <Link
                href="/assistente"
                className="group flex items-center gap-3 no-underline"
              >
                <span className="text-[11px] text-[var(--color-dim)] group-hover:text-[var(--color-muted)] transition-colors">
                  Hai bisogno di aiuto? L'assistente può guidarti nella compilazione del profilo.
                </span>
                <span className="text-[var(--color-dim)] group-hover:text-[var(--color-muted)] text-[12px] transition-colors shrink-0">
                  Apri assistente →
                </span>
              </Link>
            </div>

          </div>
        </div>
      )}

      {/* ── Stats ───────────────────────────────────────────────── */}
      <div className="section-label mb-4">Overview</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {[
          { label: 'Trovate',    val: stats.total,   color: 'var(--color-blue)' },
          { label: 'Analizzate', val: stats.checked, color: 'var(--color-purple)' },
          { label: 'Scored',     val: stats.scored,  color: 'var(--color-yellow)' },
          { label: 'CV scritti', val: stats.writing, color: 'var(--color-orange)' },
          { label: 'Pronte',     val: stats.ready,   color: '#7fffb2' },
          { label: 'Inviate',    val: stats.applied, color: 'var(--color-green)' },
        ].map(({ label, val, color }) => (
          <div
            key={label}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
          >
            <div className="text-[9.5px] font-semibold tracking-[0.14em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>
              {label}
            </div>
            <div className="text-3xl font-bold leading-none tracking-tight" style={{ color }}>
              {val}
            </div>
          </div>
        ))}
      </div>

      {/* ── Pipeline ────────────────────────────────────────────── */}
      <div className="section-label mb-4">Pipeline</div>
      <div className="overflow-x-auto mb-8">
        <div className="flex min-w-max border border-[var(--color-border)] rounded-lg overflow-hidden">
          {pipeline.map((step, i) => (
            <Link
              key={step.key}
              href={`/positions?status=${step.key}`}
              className="flex-1 min-w-[90px] flex flex-col items-center px-4 py-4 bg-[var(--color-card)] hover:bg-[var(--color-row)] transition-colors text-center no-underline"
              style={{ borderRight: i < pipeline.length - 1 ? '1px solid var(--color-border)' : 'none' }}
            >
              <span className="text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--color-dim)] mb-2">
                {step.label}
              </span>
              <span className="text-2xl font-bold leading-none tracking-tight" style={{ color: step.color }}>
                {step.count}
              </span>
              <div
                className="w-full h-0.5 rounded-full mt-2.5 mb-1"
                style={{ background: step.color, opacity: 0.7 }}
              />
              <span className="text-[9px]" style={{ color: 'var(--color-dim)' }}>
                {activeTotal > 0 ? Math.round((step.count / activeTotal) * 100) : 0}%
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Charts ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

        {/* Score distribution */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="section-label">Distribuzione Score</span>
            {scoreDist.avgScore != null && (
              <span className="text-[11px] font-semibold" style={{ color: scoreDist.avgScore >= 75 ? 'var(--color-green)' : scoreDist.avgScore >= 55 ? 'var(--color-yellow)' : 'var(--color-red)' }}>
                media {scoreDist.avgScore}
              </span>
            )}
          </div>
          <div className="space-y-3 mb-3">
            {scoreDist.buckets.map(b => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-[9.5px] font-semibold w-12 text-right shrink-0" style={{ color: b.color }}>{b.label}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${scoreDist.withScore > 0 ? (b.count / scoreDist.withScore) * 100 : 0}%`, background: b.color, opacity: 0.85 }}
                  />
                </div>
                <span className="text-[11px] font-bold w-6 text-right shrink-0" style={{ color: b.color }}>{b.count}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--color-dim)]">
            {scoreDist.withScore} su {scoreDist.total} con score · {scoreDist.total - scoreDist.withScore} senza
          </p>
        </div>

        {/* Source distribution */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
          <div className="section-label mb-4">Fonti</div>
          <div className="space-y-3">
            {sourceDist.length === 0 ? (
              <p className="text-[11px] text-[var(--color-dim)]">Nessun dato</p>
            ) : (() => {
              const max = sourceDist[0]?.count ?? 1
              return sourceDist.map(s => (
                <div key={s.source} className="flex items-center gap-3">
                  <span className="text-[9.5px] text-[var(--color-muted)] w-28 truncate shrink-0">{s.source}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(s.count / max) * 100}%`, background: 'var(--color-blue)', opacity: 0.7 }} />
                  </div>
                  <span className="text-[11px] font-bold text-[var(--color-blue)] w-6 text-right shrink-0">{s.count}</span>
                </div>
              ))
            })()}
          </div>
        </div>
      </div>

      {/* ── Positions table ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">Posizioni recenti</span>
        <Link
          href="/positions"
          className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
        >
          Vedi tutte →
        </Link>
      </div>
      <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg mb-8">
        <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
              {['ID', 'Titolo', 'Azienda', 'Location', 'Remote', 'Score', 'Stato'].map(h => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap"
                  style={{ color: 'var(--color-dim)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[var(--color-dim)] text-[11px]">
                  Nessuna posizione trovata.
                </td>
              </tr>
            ) : positions.map((p: PositionWithScore, i: number) => (
              <tr
                key={p.id}
                className="border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
                style={{
                  borderBottomColor: i === positions.length - 1 ? 'transparent' : undefined,
                  background: i % 2 === 1 ? 'rgba(255,255,255,0.008)' : undefined,
                }}
              >
                <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap">
                  {p.legacy_id ? `JHT-${String(p.legacy_id).padStart(3, '0')}` : p.id.slice(0, 8)}
                </td>
                <td className="px-4 py-3 font-medium whitespace-nowrap max-w-[200px] truncate">
                  <Link
                    href={`/positions/${p.id}`}
                    className="text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors"
                  >
                    {p.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--color-base)] whitespace-nowrap">
                  {p.company}
                </td>
                <td className="px-4 py-3 text-[11px] text-[var(--color-muted)] whitespace-nowrap">
                  {p.location ?? '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-[10px]" style={{
                    color: p.remote_type === 'full_remote'
                      ? 'var(--color-green)'
                      : p.remote_type === 'hybrid'
                      ? 'var(--color-yellow)'
                      : 'var(--color-red)',
                  }}>
                    {p.remote_type?.replace('_', ' ') ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <span className={`text-[12px] font-semibold w-6 text-right ${scoreClass(p.score)}`}>
                      {p.score ?? '—'}
                    </span>
                    <div className="w-10 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${p.score ?? 0}%`, background: scoreBg(p.score) }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border"
                    style={{
                      color: STATUS_COLORS[p.status] ?? 'var(--color-dim)',
                      borderColor: STATUS_COLORS[p.status] ?? 'var(--color-border)',
                      background: `${STATUS_COLORS[p.status]}18`,
                    }}
                  >
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <OnboardingWizard />
    </div>
  )
}
