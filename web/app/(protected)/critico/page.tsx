'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import AgentInteraction from '@/components/AgentInteraction'

// ── Types ──────────────────────────────────────────────────────────
interface LiveStats {
  total: number
  pending: number
  pass: number
  needsWork: number
  reject: number
  avgScore: number | null
}

interface QueueItem {
  id: string
  title: string
  company: string
  written_by: string | null
  written_at: string | null
}

interface FeedItem {
  id: string
  title: string
  company: string
  critic_verdict: 'PASS' | 'NEEDS_WORK' | 'REJECT' | null
  critic_score: number | null
  critic_round: number | null
  critic_reviewed_at: string | null
  reviewed_by: string | null
  written_by: string | null
}

interface AgentStat {
  critico: string
  total: number
  pass: number
  needsWork: number
  reject: number
}

interface LiveData {
  stats: LiveStats
  queue: QueueItem[]
  feed: FeedItem[]
  byAgent: AgentStat[]
}

// ── Helpers ────────────────────────────────────────────────────────
function fmtTs(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function verdictColor(v: string | null) {
  if (v === 'PASS')       return 'var(--color-green)'
  if (v === 'NEEDS_WORK') return 'var(--color-yellow)'
  if (v === 'REJECT')     return 'var(--color-red)'
  return 'var(--color-dim)'
}

function verdictLabel(v: string | null) {
  if (v === 'PASS')       return 'PASS'
  if (v === 'NEEDS_WORK') return 'NEEDS WORK'
  if (v === 'REJECT')     return 'REJECT'
  return '—'
}

function scoreColor(s: number | null) {
  if (s == null) return 'var(--color-dim)'
  if (s >= 7)    return 'var(--color-green)'
  if (s >= 5.5)  return 'var(--color-yellow)'
  return 'var(--color-red)'
}

// ── Sub-components ─────────────────────────────────────────────────
function StatCard({ label, val, color, sub }: {
  label: string; val: string | number; color: string; sub?: string
}) {
  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
      <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--color-dim)' }}>{label}</div>
      <div className="text-3xl font-bold tracking-tight leading-none" style={{ color }}>{val}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color: 'var(--color-dim)' }}>{sub}</div>}
    </div>
  )
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  return (
    <span
      className="text-[9px] font-bold tracking-widest px-2 py-0.5 rounded"
      style={{
        color:      verdictColor(verdict),
        background: verdictColor(verdict) + '18',
        border:     `1px solid ${verdictColor(verdict)}40`,
      }}
    >
      {verdictLabel(verdict)}
    </span>
  )
}

// ── Page ───────────────────────────────────────────────────────────
export default function CriticoPage() {
  const [live, setLive]           = useState<LiveData | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [error, setError]         = useState<string | null>(null)

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch('/api/critico', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: LiveData = await res.json()
      setLive(data)
      setLastUpdate(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore fetch')
    }
  }, [])

  // Polling ogni 8s
  useEffect(() => {
    fetchLive()
    const id = setInterval(fetchLive, 8_000)
    return () => clearInterval(id)
  }, [fetchLive])

  const stats   = live?.stats
  const queue   = live?.queue   ?? []
  const feed    = live?.feed    ?? []
  const byAgent = live?.byAgent ?? []

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Critico</span>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">⚖️ Critico</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              Revisioni CV · aggiornamento automatico ogni 8s
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-[9px] text-[var(--color-dim)]">
                agg. {lastUpdate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: error ? 'var(--color-red)' : live ? 'var(--color-green)' : 'var(--color-yellow)',
                boxShadow:  error ? 'none' : live ? '0 0 6px var(--color-green)' : 'none',
              }}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg text-[11px]"
          style={{ background: 'var(--color-red)18', border: '1px solid var(--color-red)40', color: 'var(--color-red)' }}>
          Errore connessione: {error}
        </div>
      )}

      {/* ── Stats bar real-time ───────────────────────────────────── */}
      <div className="section-label mb-4">Stats real-time</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
        <StatCard label="Revisioni totali" val={stats?.total    ?? '—'} color="var(--color-orange)" />
        <StatCard label="In attesa coda"   val={stats?.pending  ?? '—'} color="#58a6ff" />
        <StatCard label="PASS"             val={stats?.pass     ?? '—'} color="var(--color-green)" />
        <StatCard label="Needs Work"       val={stats?.needsWork ?? '—'} color="var(--color-yellow)" />
        <StatCard label="Reject"           val={stats?.reject   ?? '—'} color="var(--color-red)" />
        <StatCard
          label="Media voto"
          val={stats?.avgScore != null ? stats.avgScore : '—'}
          color="var(--color-cyan)"
          sub={stats?.avgScore != null ? '/10' : undefined}
        />
      </div>

      {/* ── Coda review in attesa ─────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="section-label">Coda review in attesa</div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded"
          style={{ background: '#58a6ff18', color: '#58a6ff', border: '1px solid #58a6ff40' }}>
          {queue.length} in coda
        </span>
      </div>

      {!live ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 text-center text-[var(--color-dim)] text-[11px] mb-10">
          Caricamento…
        </div>
      ) : queue.length === 0 ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 text-center text-[var(--color-dim)] text-[11px] mb-10">
          Coda vuota — nessun CV in attesa di review.
        </div>
      ) : (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden mb-10">
          <table className="w-full border-collapse" aria-label="Coda revisioni CV">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['#', 'Posizione', 'Azienda', 'Scrittore', 'Scritto il'].map(h => (
                  <th key={h} scope="col" className="text-left px-4 py-3 text-[9px] font-semibold tracking-widest uppercase"
                    style={{ color: 'var(--color-dim)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queue.map((item, i) => (
                <tr key={item.id}
                  style={{ borderBottom: i < queue.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <td className="px-4 py-3 text-[11px] font-mono" style={{ color: 'var(--color-dim)' }}>
                    {i + 1}
                  </td>
                  <td className="px-4 py-3 text-[12px] font-medium text-[var(--color-white)]" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </td>
                  <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {item.company}
                  </td>
                  <td className="px-4 py-3 text-[11px] font-mono" style={{ color: 'var(--color-cyan)' }}>
                    {item.written_by ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--color-dim)' }}>
                    {fmtTs(item.written_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Feed ultime 10 revisioni ──────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="section-label">Ultime revisioni</div>
        <span className="text-[9px]" style={{ color: 'var(--color-dim)' }}>
          ultimi {feed.length} verdetti
        </span>
      </div>

      {!live ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 text-center text-[var(--color-dim)] text-[11px] mb-10">
          Caricamento…
        </div>
      ) : feed.length === 0 ? (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 text-center text-[var(--color-dim)] text-[11px] mb-10">
          Nessuna revisione completata.
        </div>
      ) : (
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden mb-10">
          <table className="w-full border-collapse" aria-label="Revisioni completate">
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['Posizione', 'Azienda', 'Verdetto', 'Voto', 'Round', 'Revisore', 'Data review'].map(h => (
                  <th key={h} scope="col" className="text-left px-4 py-3 text-[9px] font-semibold tracking-widest uppercase"
                    style={{ color: 'var(--color-dim)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {feed.map((item, i) => (
                <tr key={item.id}
                  style={{ borderBottom: i < feed.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <td className="px-4 py-3 text-[12px] font-medium text-[var(--color-white)]"
                    style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </td>
                  <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {item.company}
                  </td>
                  <td className="px-4 py-3">
                    <VerdictBadge verdict={item.critic_verdict} />
                  </td>
                  <td className="px-4 py-3 text-[14px] font-bold font-mono"
                    style={{ color: scoreColor(item.critic_score) }}>
                    {item.critic_score != null ? item.critic_score : '—'}
                  </td>
                  <td className="px-4 py-3 text-[11px] font-mono text-center" style={{ color: 'var(--color-dim)' }}>
                    {item.critic_round != null ? `R${item.critic_round}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-[11px] font-mono" style={{ color: 'var(--color-cyan)' }}>
                    {item.reviewed_by ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--color-dim)', whiteSpace: 'nowrap' }}>
                    {fmtTs(item.critic_reviewed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Stats per agente ──────────────────────────────────────── */}
      {byAgent.length > 0 && (
        <>
          <div className="section-label mb-4">Attività per Critico</div>
          <div className="space-y-4">
            {byAgent.map((s, i) => {
              const colors = ['var(--color-orange)', 'var(--color-red)', 'var(--color-yellow)']
              const color  = colors[i % colors.length]
              const pctPass = s.total > 0 ? ((s.pass / s.total) * 100).toFixed(1) : '0'
              return (
                <div key={s.critico} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <span className="text-[13px] font-bold" style={{ color }}>{s.critico}</span>
                      <span className="text-[10px] text-[var(--color-dim)] ml-2">{s.total} revisioni</span>
                    </div>
                    <div className="text-[10px] text-[var(--color-dim)]">{pctPass}% PASS</div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                      { label: 'PASS',       val: s.pass,      c: 'var(--color-green)' },
                      { label: 'Needs Work', val: s.needsWork, c: 'var(--color-yellow)' },
                      { label: 'Reject',     val: s.reject,    c: 'var(--color-red)' },
                    ].map(({ label, val, c }) => (
                      <div key={label} className="text-center">
                        <div className="text-[9px] font-semibold tracking-widest uppercase mb-1" style={{ color: c }}>{label}</div>
                        <div className="text-2xl font-bold" style={{ color: c }}>{val}</div>
                        {s.total > 0 && (
                          <div className="text-[10px] text-[var(--color-dim)] mt-0.5">
                            {((val / s.total) * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Stacked bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-[var(--color-dim)] w-14 text-right shrink-0">verdict</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden flex" style={{ background: 'var(--color-border)' }}>
                      {s.total > 0 && <>
                        <div style={{ width: `${(s.pass      / s.total) * 100}%`, background: 'var(--color-green)',  opacity: 0.85 }} />
                        <div style={{ width: `${(s.needsWork / s.total) * 100}%`, background: 'var(--color-yellow)', opacity: 0.85 }} />
                        <div style={{ width: `${(s.reject    / s.total) * 100}%`, background: 'var(--color-red)',    opacity: 0.85 }} />
                      </>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <AgentInteraction sessionPrefix="CRITICO" color="#f44336" label="Critico" />

    </div>
  )
}
