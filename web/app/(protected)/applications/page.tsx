import Link from 'next/link'
import { getApplications } from '@/lib/queries'
import type { ApplicationWithPosition } from '@/lib/types'

const CRITIC_COLORS: Record<string, string> = {
  PASS:       'var(--color-green)',
  NEEDS_WORK: 'var(--color-yellow)',
  REJECT:     'var(--color-red)',
}

const APP_STATUS_COLORS: Record<string, string> = {
  draft:    'var(--color-dim)',
  review:   'var(--color-orange)',
  approved: 'var(--color-blue)',
  ready:    '#7fffb2',
  applied:  'var(--color-green)',
  response: '#58a6ff',
}

const POS_STATUS_COLORS: Record<string, string> = {
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

const SHEETS_URL = process.env.NEXT_PUBLIC_GOOGLE_SHEETS_ID
  ? `https://docs.google.com/spreadsheets/d/${process.env.NEXT_PUBLIC_GOOGLE_SHEETS_ID}`
  : null

export default async function ApplicationsPage() {
  const applications = await getApplications()

  const applied    = applications.filter(a => a.applied || a.status === 'applied' || a.status === 'response')
  const ready      = applications.filter(a => a.status === 'ready' && !a.applied)
  // BUG-DATA-02: 33 app con critic PASS bloccate in draft per workflow legacy
  const passedDraft = applications.filter(
    a => a.critic_verdict === 'PASS' && (a.status === 'draft' || a.status === 'review') && !a.applied
  )
  const other      = applications.filter(
    a => !a.applied && a.status !== 'applied' && a.status !== 'response' && a.status !== 'ready'
    && !(a.critic_verdict === 'PASS' && (a.status === 'draft' || a.status === 'review'))
  )

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Candidature</span>
        </nav>
        <div className="flex items-start justify-between gap-4 mt-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Candidature</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {applications.length} totali · {applied.length} inviate · {ready.length + passedDraft.length} pronte
            </p>
          </div>
          {SHEETS_URL && (
            <a
              href={SHEETS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
              style={{ borderColor: 'var(--color-green)', color: 'var(--color-green)' }}
            >
              Google Sheets ↗
            </a>
          )}
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────── */}
      {applications.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8" style={{ animation: 'fade-in 0.35s ease both' }}>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>Totali</div>
            <div className="text-3xl font-bold tracking-tight leading-none" style={{ color: 'var(--color-bright)' }}>{applications.length}</div>
          </div>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>Inviate</div>
            <div className="text-3xl font-bold tracking-tight leading-none" style={{ color: 'var(--color-green)' }}>{applied.length}</div>
          </div>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>Pronte</div>
            <div className="text-3xl font-bold tracking-tight leading-none" style={{ color: '#7fffb2' }}>{ready.length + passedDraft.length}</div>
          </div>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>In lavorazione</div>
            <div className="text-3xl font-bold tracking-tight leading-none" style={{ color: 'var(--color-yellow)' }}>{other.length}</div>
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────── */}
      {applications.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center" style={{ animation: 'fade-in 0.35s ease both' }}>
          <div className="text-4xl mb-4" aria-hidden="true" style={{ opacity: 0.3 }}>📋</div>
          <p className="text-[var(--color-muted)] text-[13px]">Nessuna candidatura ancora.</p>
          <p className="text-[var(--color-dim)] text-[11px] mt-1">Le candidature appariranno qui quando gli agenti le creeranno.</p>
        </div>
      )}

      {/* ── Pronte all'invio ─────────────────────────────────────── */}
      {ready.length > 0 && (
        <section className="mb-8" style={{ animation: 'fade-in 0.35s ease both 0.05s' }}>
          <div className="section-label mb-4" style={{ color: '#7fffb2' }}>Pronte all&apos;invio — {ready.length}</div>
          <div className="space-y-3">
            {ready.map(a => <ApplicationCard key={a.id} app={a} highlight />)}
          </div>
        </section>
      )}

      {/* ── Approvate dal critico (workflow legacy) ─────────────── */}
      {passedDraft.length > 0 && (
        <section className="mb-8" style={{ animation: 'fade-in 0.35s ease both 0.1s' }}>
          <div className="section-label mb-1" style={{ color: 'var(--color-green)' }}>
            Approvate dal critico — {passedDraft.length}
          </div>
          <p className="text-[10px] text-[var(--color-dim)] mb-4">
            CV approvati (PASS) — status non aggiornato nel legacy. Pronte per l&apos;invio.
          </p>
          <div className="space-y-3">
            {passedDraft.map(a => <ApplicationCard key={a.id} app={a} highlight />)}
          </div>
        </section>
      )}

      {/* ── Inviate ─────────────────────────────────────────────── */}
      {applied.length > 0 && (
        <section className="mb-8" style={{ animation: 'fade-in 0.35s ease both 0.15s' }}>
          <div className="section-label mb-4">Inviate — {applied.length}</div>
          <div className="space-y-3">
            {applied.map(a => <ApplicationCard key={a.id} app={a} />)}
          </div>
        </section>
      )}

      {/* ── In lavorazione ──────────────────────────────────────── */}
      {other.length > 0 && (
        <section className="mb-8" style={{ animation: 'fade-in 0.35s ease both 0.2s' }}>
          <div className="section-label mb-4">In lavorazione — {other.length}</div>
          <div className="space-y-3">
            {other.map(a => <ApplicationCard key={a.id} app={a} />)}
          </div>
        </section>
      )}

    </div>
  )
}

function ApplicationCard({ app, highlight }: { app: ApplicationWithPosition; highlight?: boolean }) {
  const pos = app.positions
  const statusColor = APP_STATUS_COLORS[app.status] ?? 'var(--color-dim)'
  const posStatusColor = POS_STATUS_COLORS[pos?.status ?? 'new'] ?? 'var(--color-dim)'

  return (
    <div
      className="bg-[var(--color-card)] border rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors"
      style={{ borderColor: highlight ? '#7fffb230' : 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">

        {/* Left: position info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Link
              href={pos?.id ? `/positions/${pos.id}` : '#'}
              className="font-semibold text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors"
            >
              {pos?.title ?? '—'}
            </Link>
            {pos?.status && (
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border"
                style={{ color: posStatusColor, borderColor: posStatusColor, background: `${posStatusColor}18` }}
              >
                {pos.status}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-[var(--color-muted)]">{pos?.company ?? '—'}</span>
            {app.applied_at && (
              <span className="text-[10px] text-[var(--color-dim)]">inviata {app.applied_at.slice(0, 10)}</span>
            )}
            {app.applied_via && (
              <span className="text-[10px] text-[var(--color-dim)]">via {app.applied_via}</span>
            )}
          </div>
          {app.response && (
            <div className="mt-2 text-[11px] px-2 py-1 rounded border inline-block" style={{ borderColor: 'var(--color-border)', color: '#58a6ff' }}>
              Risposta: {app.response}
            </div>
          )}
        </div>

        {/* Right: status + drive links */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {app.critic_verdict && (
            <span
              className="text-[9.5px] font-bold px-2 py-0.5 rounded border"
              style={{ color: CRITIC_COLORS[app.critic_verdict], borderColor: CRITIC_COLORS[app.critic_verdict] }}
            >
              {app.critic_verdict}
              {app.critic_score && ` ${app.critic_score}/10`}
            </span>
          )}
          <span
            className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border"
            style={{ color: statusColor, borderColor: statusColor, background: `${statusColor}18` }}
          >
            {app.status}
          </span>
        </div>
      </div>

      {/* Drive links */}
      {(app.cv_drive_id || app.cl_drive_id) && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--color-border)] flex-wrap">
          {app.cv_drive_id && (
            <a
              href={`https://drive.google.com/file/d/${app.cv_drive_id}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
              style={{ borderColor: 'var(--color-green)', color: 'var(--color-green)' }}
            >
              CV ↗
            </a>
          )}
          {app.cl_drive_id && (
            <a
              href={`https://drive.google.com/file/d/${app.cl_drive_id}/view`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
              style={{ borderColor: 'var(--color-blue)', color: 'var(--color-blue)' }}
            >
              Cover Letter ↗
            </a>
          )}
          {pos?.url && (
            <a
              href={pos.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-dim)' }}
            >
              Offerta ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}
