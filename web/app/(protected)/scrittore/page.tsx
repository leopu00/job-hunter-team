'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import AgentInteraction from '@/components/AgentInteraction'

type PositionItem = {
  id: number
  title: string
  company: string
  location: string | null
  remote_type: string | null
  status?: string
  notes?: string | null
  total_score?: number | null
  written_by?: string | null
  critic_score?: number | null
  critic_verdict?: string | null
  critic_round?: number | null
  written_at?: string | null
  critic_reviewed_at?: string | null
  critic_active?: boolean
}

type ScrittoreActivity = {
  queue: PositionItem[]
  in_progress: PositionItem[]
  recent_completed: PositionItem[]
  queue_size: number
  writing_today: number
  completed_today: number
  avg_critic_score: number | null
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return ''
  const parts = ts.split('T')
  const date = (parts[0] ?? ts).split('-')
  const time = (parts[1] ?? '').slice(0, 5)
  if (date.length < 3) return ts
  return `${date[2]}/${date[1]}/${date[0]} ${time}`
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'var(--color-green)' : score >= 50 ? 'var(--color-yellow)' : score >= 40 ? 'var(--color-orange)' : 'var(--color-red)'
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: '0.7em', background: color, color: '#000', fontWeight: 700 }}>
      {score}
    </span>
  )
}

function CriticBadge({ score }: { score: number }) {
  const color = score >= 7 ? 'var(--color-green)' : score >= 5 ? 'var(--color-yellow)' : 'var(--color-red)'
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: '0.7em', background: color, color: '#000', fontWeight: 700 }}>
      {score}/10
    </span>
  )
}

function RoundBadge({ round }: { round: number }) {
  const colors: Record<number, string> = { 1: 'var(--color-blue)', 2: '#b388ff', 3: '#00bcd4' }
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: '0.65em', background: colors[round] ?? 'var(--color-dim)', color: '#000', fontWeight: 700 }}>
      Round {round}/3
    </span>
  )
}

function WritingTag() {
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: '0.65em', background: 'var(--color-yellow)', color: '#000', fontWeight: 700 }}>
      IN SCRITTURA
    </span>
  )
}

function CriticoActiveTag() {
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: '0.65em', background: '#b388ff', color: '#fff', fontWeight: 700 }}>
      <span aria-hidden="true">⚖️</span> CRITICO
    </span>
  )
}

function QueueItem({ p }: { p: PositionItem }) {
  const loc = p.remote_type === 'full_remote' ? 'Remote' : (p.location ?? '').split(',')[0]
  const inWriting = (p.notes ?? '').includes('IN_WRITING')
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-border)] transition-colors"
      style={{ background: inWriting ? 'rgba(255,214,0,0.06)' : undefined, fontSize: '0.82em' }}
    >
      <span className="font-mono text-[var(--color-dim)] shrink-0">#{p.id}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[var(--color-bright)] truncate" title={p.title}>{p.title}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className="text-[var(--color-muted)]">{p.company}</span>
          {loc && <span className="text-[var(--color-dim)]">{loc}</span>}
          {p.total_score != null && <ScoreBadge score={p.total_score} />}
          {inWriting && <WritingTag />}
        </div>
      </div>
    </div>
  )
}

function ProgressItem({ p }: { p: PositionItem }) {
  const loc = p.remote_type === 'full_remote' ? 'Remote' : (p.location ?? '').split(',')[0]
  const writerTag = p.written_by ? p.written_by.replace('scrittore-', 'S') : null
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-border)] transition-colors"
      style={{ background: 'rgba(255,214,0,0.04)', fontSize: '0.82em' }}
    >
      <span className="font-mono text-[var(--color-dim)] shrink-0">#{p.id}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[var(--color-bright)] truncate" title={p.title}>{p.title}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className="text-[var(--color-muted)]">{p.company}</span>
          {loc && <span className="text-[var(--color-dim)]">{loc}</span>}
          {writerTag && <span style={{ fontSize: '0.85em', color: '#00bcd4', fontWeight: 600 }}>{writerTag}</span>}
          {p.critic_round != null && <RoundBadge round={p.critic_round} />}
          {p.critic_active ? (
            <CriticoActiveTag />
          ) : p.critic_score != null ? (
            <CriticBadge score={p.critic_score} />
          ) : (
            <WritingTag />
          )}
          {p.total_score != null && <ScoreBadge score={p.total_score} />}
        </div>
      </div>
    </div>
  )
}

function CompletedItem({ p }: { p: PositionItem }) {
  const writerTag = p.written_by ? p.written_by.replace('scrittore-', 'S') : null
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 rounded-md hover:bg-[var(--color-border)] transition-colors"
      style={{ fontSize: '0.82em' }}
    >
      <span className="font-mono text-[var(--color-dim)] shrink-0">#{p.id}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-[var(--color-bright)] truncate" title={p.title}>{p.title}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className="text-[var(--color-muted)]">{p.company}</span>
          {writerTag && <span style={{ fontSize: '0.85em', color: '#00bcd4', fontWeight: 600 }}>{writerTag}</span>}
          {p.critic_score != null && <CriticBadge score={p.critic_score} />}
          {p.critic_reviewed_at && (
            <span className="text-[var(--color-dim)]" style={{ fontSize: '0.85em' }}>{fmtTs(p.critic_reviewed_at)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ScrittorePage() {
  const [data, setData] = useState<ScrittoreActivity | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/scrittore/activity')
      const json = await res.json()
      setData(json)
      setLastUpdate(new Date())
    } catch {}
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 8000)
    return () => clearInterval(id)
  }, [fetchData])

  const avgColor = data?.avg_critic_score != null
    ? data.avg_critic_score >= 7 ? 'var(--color-green)' : data.avg_critic_score >= 5 ? 'var(--color-yellow)' : 'var(--color-red)'
    : 'var(--color-dim)'

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Scrittore</span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Scrittore</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">Pipeline scrittura CV · polling 8s</p>
          </div>
          {lastUpdate && (
            <span className="text-[9px] text-[var(--color-dim)] font-mono shrink-0">
              {lastUpdate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8" style={{ animation: 'fade-in 0.35s ease both' }}>
        {[
          { label: 'In coda', val: data?.queue_size ?? '—', color: 'var(--color-orange)' },
          { label: 'Scritti oggi', val: data?.writing_today ?? '—', color: 'var(--color-yellow)' },
          { label: 'Completati', val: data?.completed_today ?? '—', color: 'var(--color-green)' },
          { label: 'Media critico', val: data?.avg_critic_score != null ? `${data.avg_critic_score}/10` : '—', color: avgColor },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-border-glow)] transition-colors">
            <div className="text-[9px] font-semibold tracking-[0.15em] uppercase mb-2 text-[var(--color-dim)]">{label}</div>
            <div className="text-3xl font-bold tracking-tight leading-none" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Coda + In lavorazione */}
      <div className="grid sm:grid-cols-2 gap-4 mb-4" style={{ animation: 'fade-in 0.35s ease 0.05s both' }}>

        {/* Coda scored */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <h3 className="text-[11px] font-semibold tracking-wider uppercase text-[var(--color-muted)] mb-3">
            In Coda — Scored (top 15)
          </h3>
          {!data || data.queue.length === 0 ? (
            <p className="text-[var(--color-dim)] text-[11px] px-3">Nessuna posizione in coda</p>
          ) : (
            <div className="space-y-0.5">
              {data.queue.map(p => <QueueItem key={p.id} p={p} />)}
            </div>
          )}
        </div>

        {/* In lavorazione */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
          <h3 className="text-[11px] font-semibold tracking-wider uppercase mb-3" style={{ color: 'var(--color-yellow)' }}>
            In Lavorazione
          </h3>
          {!data || data.in_progress.length === 0 ? (
            <p className="text-[var(--color-dim)] text-[11px] px-3">Nessuno scrittore attivo</p>
          ) : (
            <div className="space-y-0.5">
              {data.in_progress.map(p => <ProgressItem key={p.id} p={p} />)}
            </div>
          )}
        </div>
      </div>

      {/* Ultimi completati */}
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4" style={{ animation: 'fade-in 0.35s ease 0.1s both' }}>
        <h3 className="text-[11px] font-semibold tracking-wider uppercase mb-3" style={{ color: 'var(--color-green)' }}>
          Ultimi 10 Completati
        </h3>
        {!data || data.recent_completed.length === 0 ? (
          <p className="text-[var(--color-dim)] text-[11px] px-3">Nessun CV completato</p>
        ) : (
          <div className="space-y-0.5">
            {data.recent_completed.map(p => <CompletedItem key={p.id} p={p} />)}
          </div>
        )}
      </div>

      <AgentInteraction sessionPrefix="SCRITTORE" color="#ffd600" label="Scrittore" />

    </div>
  )
}
