import Link from 'next/link'
import { getApplicationsByStatus, getPositions } from '@/lib/queries'
import type { ApplicationWithPosition, PositionWithScore } from '@/lib/types'

const DRIVE_BASE = 'https://drive.google.com/file/d'

export default async function ReadyPage() {
  const [readyApps, readyPositions] = await Promise.all([
    getApplicationsByStatus('ready'),
    getPositions({ status: 'ready', limit: 200 }),
  ])

  // Positions that have no application at all or app in draft
  const appsWithReadyPositions = readyPositions.filter(
    p => !readyApps.some(a => a.position_id === p.id)
  )

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Pronte all&apos;invio</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Pronte all&apos;invio</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            {readyApps.length} candidature con CV pronto ·{' '}
            {readyPositions.length} posizioni ready nel pipeline
          </p>
        </div>
      </div>

      {/* ── Candidature pronte (CV scritto, da inviare) ─────────── */}
      <section className="mb-10">
        <div className="section-label mb-4" style={{ color: '#7fffb2' }}>
          CV pronti da inviare — {readyApps.length}
        </div>
        {readyApps.length === 0 ? (
          <p className="text-[var(--color-dim)] text-[12px]">Nessuna candidatura pronta.</p>
        ) : (
          <div className="space-y-3">
            {readyApps.map(a => <ReadyAppCard key={a.id} app={a} />)}
          </div>
        )}
      </section>

      {/* ── Posizioni ready (CV da scrivere) ────────────────────── */}
      <section className="mb-8">
        <div className="section-label mb-4" style={{ color: 'var(--color-orange)' }}>
          Posizioni ready — CV da scrivere ({appsWithReadyPositions.length})
        </div>
        {appsWithReadyPositions.length === 0 ? (
          <p className="text-[var(--color-dim)] text-[12px]">Nessuna posizione in attesa.</p>
        ) : (
          <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg">
            <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
                  {['Titolo', 'Azienda', 'Location', 'Remote', 'Score'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap" style={{ color: 'var(--color-dim)' }}>
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
                      <span style={{ color: p.remote_type === 'full_remote' ? 'var(--color-green)' : p.remote_type === 'hybrid' ? 'var(--color-yellow)' : 'var(--color-red)', fontSize: '10px' }}>
                        {p.remote_type?.replace('_', ' ') ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-semibold" style={{ color: p.score && p.score >= 75 ? 'var(--color-green)' : p.score && p.score >= 55 ? 'var(--color-yellow)' : 'var(--color-red)' }}>
                        {p.score ?? '—'}
                      </span>
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

function ReadyAppCard({ app }: { app: ApplicationWithPosition }) {
  const pos = app.positions
  const hasDrive = app.cv_drive_id || app.cl_drive_id

  return (
    <div className="bg-[var(--color-card)] border rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors" style={{ borderColor: '#7fffb230' }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/positions/${pos?.id}`} className="font-semibold text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors">
              {pos?.title ?? '—'}
            </Link>
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border" style={{ color: '#7fffb2', borderColor: '#7fffb2', background: '#7fffb218' }}>
              ready
            </span>
          </div>
          <span className="text-[11px] text-[var(--color-muted)]">{pos?.company ?? '—'}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {app.critic_score && (
            <span className="text-[9.5px] font-bold px-2 py-0.5 rounded border" style={{ color: 'var(--color-green)', borderColor: 'var(--color-green)' }}>
              Score {app.critic_score}/10
            </span>
          )}
        </div>
      </div>

      {/* Drive links */}
      <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--color-border)] flex-wrap">
        {app.cv_drive_id ? (
          <a href={`${DRIVE_BASE}/${app.cv_drive_id}/view`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
            style={{ borderColor: 'var(--color-green)', color: 'var(--color-green)' }}>
            CV ↗
          </a>
        ) : (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold" style={{ borderColor: 'var(--color-border)', color: 'var(--color-dim)' }}>
            CV — non su Drive
          </span>
        )}
        {app.cl_drive_id ? (
          <a href={`${DRIVE_BASE}/${app.cl_drive_id}/view`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
            style={{ borderColor: 'var(--color-blue)', color: 'var(--color-blue)' }}>
            Cover Letter ↗
          </a>
        ) : (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold" style={{ borderColor: 'var(--color-border)', color: 'var(--color-dim)' }}>
            CL — non su Drive
          </span>
        )}
        {pos?.url && (
          <a href={pos.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-dim)' }}>
            Offerta ↗
          </a>
        )}
      </div>
    </div>
  )
}
