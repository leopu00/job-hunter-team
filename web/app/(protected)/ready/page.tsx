import Link from 'next/link'
import { getApplicationsByStatus, getPositions } from '@/lib/queries'
import type { ApplicationWithPosition, PositionWithScore } from '@/lib/types'

const DRIVE_BASE = 'https://drive.google.com/file/d'

export default async function ReadyPage() {
  const [readyApps, readyPositions] = await Promise.all([
    getApplicationsByStatus('ready'),
    getPositions({ status: 'ready', limit: 200 }),
  ])

  const appsWithReadyPositions = readyPositions.filter(
    p => !readyApps.some(a => a.position_id === p.id)
  )

  // Stats
  const avgScore = readyApps.length > 0
    ? Math.round(readyApps.reduce((s, a) => s + (a.critic_score ?? 0), 0) / readyApps.filter(a => a.critic_score != null).length) || 0
    : 0
  const withDrive = readyApps.filter(a => a.cv_drive_id).length
  const drivePercent = readyApps.length > 0 ? Math.round((withDrive / readyApps.length) * 100) : 0

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Pronte all&apos;invio</span>
        </nav>
        <div className="mt-3 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Pronte all&apos;invio</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              Candidature con documenti pronti e posizioni in attesa di CV.
            </p>
          </div>
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard
          label="CV pronti"
          value={readyApps.length}
          color="var(--color-green)"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>}
        />
        <StatCard
          label="In attesa CV"
          value={appsWithReadyPositions.length}
          color="var(--color-orange)"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
        />
        <StatCard
          label="Score medio"
          value={avgScore > 0 ? `${avgScore}/10` : '—'}
          color="var(--color-blue)"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>}
        />
        <StatCard
          label="Su Drive"
          value={`${drivePercent}%`}
          color={drivePercent >= 80 ? 'var(--color-green)' : drivePercent >= 50 ? 'var(--color-yellow)' : 'var(--color-dim)'}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>}
        />
      </div>

      {/* ── Pipeline progress ──────────────────────────────────── */}
      {(readyApps.length > 0 || appsWithReadyPositions.length > 0) && (
        <div className="mb-8 p-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg" style={{ animation: 'fade-in 0.35s ease both' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)]">Pipeline progress</span>
            <span className="text-[10px] text-[var(--color-muted)]">
              {readyApps.length} / {readyApps.length + appsWithReadyPositions.length} con CV
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-panel)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${readyApps.length + appsWithReadyPositions.length > 0 ? Math.round((readyApps.length / (readyApps.length + appsWithReadyPositions.length)) * 100) : 0}%`,
                background: 'linear-gradient(90deg, var(--color-green), #7fffb2)',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Candidature pronte (CV scritto, da inviare) ─────────── */}
      <section className="mb-10" style={{ animation: 'fade-in 0.35s ease both 0.05s' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-2 h-2 rounded-full" style={{ background: '#7fffb2', boxShadow: '0 0 8px #7fffb2' }} />
          <span className="section-label" style={{ color: '#7fffb2', marginBottom: 0 }}>
            CV pronti da inviare — {readyApps.length}
          </span>
        </div>
        {readyApps.length === 0 ? (
          <div className="text-center py-10 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg">
            <div className="text-2xl mb-2 opacity-30">&#10003;</div>
            <p className="text-[var(--color-dim)] text-[12px]">Nessuna candidatura pronta. Le posizioni sotto attendono il CV.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {readyApps.map(a => <ReadyAppCard key={a.id} app={a} />)}
          </div>
        )}
      </section>

      {/* ── Posizioni ready (CV da scrivere) ────────────────────── */}
      <section className="mb-8" style={{ animation: 'fade-in 0.35s ease both 0.1s' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-orange)', boxShadow: '0 0 8px var(--color-orange)' }} />
          <span className="section-label" style={{ color: 'var(--color-orange)', marginBottom: 0 }}>
            Posizioni ready — CV da scrivere ({appsWithReadyPositions.length})
          </span>
        </div>
        {appsWithReadyPositions.length === 0 ? (
          <div className="text-center py-10 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg">
            <div className="text-2xl mb-2 opacity-30">&#128196;</div>
            <p className="text-[var(--color-dim)] text-[12px]">Nessuna posizione in attesa. Tutte le posizioni ready hanno un CV.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg">
            <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }} aria-label="Candidature pronte per invio">
              <thead>
                <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
                  {['Titolo', 'Azienda', 'Location', 'Remote', 'Score'].map(h => (
                    <th key={h} scope="col" className="px-4 py-3 text-left text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap" style={{ color: 'var(--color-dim)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appsWithReadyPositions.map((p, i) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
                    style={{ borderBottomColor: i === appsWithReadyPositions.length - 1 ? 'transparent' : undefined }}
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/positions/${p.id}`} className="text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors">
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">{p.company}</td>
                    <td className="px-4 py-3 text-[var(--color-dim)]">{p.location ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{
                        color: p.remote_type === 'full_remote' ? 'var(--color-green)' : p.remote_type === 'hybrid' ? 'var(--color-yellow)' : 'var(--color-red)',
                        background: p.remote_type === 'full_remote' ? 'var(--color-green)/10' : p.remote_type === 'hybrid' ? 'var(--color-yellow)/10' : 'var(--color-red)/10',
                        border: `1px solid ${p.remote_type === 'full_remote' ? 'var(--color-green)/20' : p.remote_type === 'hybrid' ? 'var(--color-yellow)/20' : 'var(--color-red)/20'}`,
                      }}>
                        {p.remote_type?.replace('_', ' ') ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBadge score={p.score} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────── */

function StatCard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 flex flex-col gap-2 transition-all duration-200 hover:border-[var(--color-border-glow)]">
      <div className="flex items-center gap-2">
        <span style={{ color }}>{icon}</span>
        <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)]">{label}</span>
      </div>
      <span className="text-xl font-bold" style={{ color }}>{value}</span>
    </div>
  )
}

function ScoreBadge({ score }: { score?: number | null }) {
  if (score == null) return <span className="text-[var(--color-dim)]">—</span>
  const color = score >= 75 ? 'var(--color-green)' : score >= 55 ? 'var(--color-yellow)' : 'var(--color-red)'
  return (
    <span className="text-[12px] font-bold px-2 py-0.5 rounded" style={{ color, background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)` }}>
      {score}
    </span>
  )
}

function ReadyAppCard({ app }: { app: ApplicationWithPosition }) {
  const pos = app.positions
  const hasCvDrive = !!app.cv_drive_id
  const hasClDrive = !!app.cl_drive_id

  return (
    <div className="bg-[var(--color-card)] border rounded-lg overflow-hidden hover:border-[var(--color-border-glow)] transition-colors" style={{ borderColor: '#7fffb230' }}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link href={pos?.id ? `/positions/${pos.id}` : '#'} className="font-semibold text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors">
                {pos?.title ?? '—'}
              </Link>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border" style={{ color: '#7fffb2', borderColor: '#7fffb2', background: '#7fffb218' }}>
                ready
              </span>
            </div>
            <span className="text-[11px] text-[var(--color-muted)]">{pos?.company ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {app.critic_score != null && (
              <span className="text-[10px] font-bold px-2 py-1 rounded" style={{
                color: app.critic_score >= 7 ? 'var(--color-green)' : app.critic_score >= 5 ? 'var(--color-yellow)' : 'var(--color-red)',
                background: app.critic_score >= 7 ? 'var(--color-green)/10' : app.critic_score >= 5 ? 'var(--color-yellow)/10' : 'var(--color-red)/10',
                border: `1px solid ${app.critic_score >= 7 ? 'var(--color-green)/20' : app.critic_score >= 5 ? 'var(--color-yellow)/20' : 'var(--color-red)/20'}`,
              }}>
                Score {app.critic_score}/10
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Documents bar */}
      <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-panel)] flex-wrap">
        <DocBadge label="CV" available={hasCvDrive} href={hasCvDrive ? `${DRIVE_BASE}/${app.cv_drive_id}/view` : undefined} color="var(--color-green)" />
        <DocBadge label="Cover Letter" available={hasClDrive} href={hasClDrive ? `${DRIVE_BASE}/${app.cl_drive_id}/view` : undefined} color="var(--color-blue)" />
        {pos?.url && (
          <a href={pos.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Offerta ↗
          </a>
        )}
      </div>
    </div>
  )
}

function DocBadge({ label, available, href, color }: { label: string; available: boolean; href?: string; color: string }) {
  if (available && href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-[10px] font-semibold no-underline transition-colors hover:opacity-80"
        style={{ borderColor: color, color }}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5L4 7L8 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label} ↗
      </a>
    )
  }
  return (
    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-[10px] font-semibold"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-dim)' }}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M2 2L8 8M8 2L2 8" stroke="var(--color-dim)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  )
}
