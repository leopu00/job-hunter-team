import Link from 'next/link'
import { getRisposte } from '@/lib/queries'
import type { ApplicationWithPosition } from '@/lib/types'

const DRIVE_BASE = 'https://drive.google.com/file/d'

export default async function RispostePage() {
  const risposte = await getRisposte()

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Risposte</span>
        </div>
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full" style={{ background: '#58a6ff', animation: risposte.length > 0 ? 'pulse-dot 2s ease-in-out infinite' : undefined }} />
            <span className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: '#58a6ff' }}>
              {risposte.length} {risposte.length !== 1 ? 'risposte' : 'risposta'} {risposte.length !== 1 ? 'ricevute' : 'ricevuta'}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Risposte</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            Aziende che hanno risposto alle candidature inviate
          </p>
        </div>
      </div>

      {/* ── Risposte ─────────────────────────────────────────────── */}
      {risposte.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4" style={{ opacity: 0.3 }}>📭</div>
          <p className="text-[var(--color-muted)] text-[13px]">Nessuna risposta ricevuta ancora.</p>
          <p className="text-[var(--color-dim)] text-[11px] mt-1">Le risposte appariranno qui quando le aziende risponderanno.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {risposte.map(a => <RispostaCard key={a.id} app={a} />)}
        </div>
      )}

    </div>
  )
}

function RispostaCard({ app }: { app: ApplicationWithPosition }) {
  const pos = app.positions

  return (
    <div className="bg-[var(--color-card)] border rounded-xl p-5 hover:border-[var(--color-border-glow)] transition-colors" style={{ borderColor: '#58a6ff30' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Link href={`/positions/${pos?.id}`} className="font-semibold text-[var(--color-bright)] hover:text-[#58a6ff] no-underline transition-colors">
              {pos?.title ?? '—'}
            </Link>
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full border" style={{ color: '#58a6ff', borderColor: '#58a6ff', background: '#58a6ff18' }}>
              risposta
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-[var(--color-muted)]">{pos?.company ?? '—'}</span>
            {app.applied_at && (
              <span className="text-[10px] text-[var(--color-dim)]">inviata {app.applied_at.slice(0, 10)}</span>
            )}
            {app.response_at && (
              <span className="text-[10px]" style={{ color: '#58a6ff' }}>risposta {app.response_at.slice(0, 10)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Risposta */}
      {app.response && (
        <div className="rounded-lg border p-4 mb-3" style={{ borderColor: '#58a6ff30', background: '#58a6ff08' }}>
          <div className="text-[9.5px] font-semibold tracking-widest uppercase mb-2" style={{ color: '#58a6ff' }}>Risposta ricevuta</div>
          <p className="text-[12px] text-[var(--color-base)] leading-relaxed">{app.response}</p>
        </div>
      )}

      {/* Interview info */}
      {app.interview_round && app.interview_round > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full border" style={{ color: 'var(--color-green)', borderColor: 'var(--color-green)', background: 'var(--color-green)18' }}>
            Round {app.interview_round}
          </span>
        </div>
      )}

      {/* Links */}
      <div className="flex gap-2 pt-3 border-t border-[var(--color-border)] flex-wrap">
        {app.cv_drive_id && (
          <a href={`${DRIVE_BASE}/${app.cv_drive_id}/view`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
            style={{ borderColor: 'var(--color-green)', color: 'var(--color-green)' }}>
            CV ↗
          </a>
        )}
        {app.cl_drive_id && (
          <a href={`${DRIVE_BASE}/${app.cl_drive_id}/view`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
            style={{ borderColor: 'var(--color-blue)', color: 'var(--color-blue)' }}>
            Cover Letter ↗
          </a>
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
