'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type CommitType = 'feat' | 'fix' | 'merge' | 'test' | 'other'
type CommitEntry = { hash: string; date: string; message: string; type: CommitType }
type DayGroup = { date: string; commits: CommitEntry[] }
type ChangelogRes = { ok: boolean; days: DayGroup[]; total: number }

const TYPE_CFG: Record<CommitType, { label: string; color: string; icon: string }> = {
  feat:  { label: 'feature', color: '#00e676', icon: '+' },
  fix:   { label: 'fix',     color: '#ffc107', icon: '~' },
  merge: { label: 'merge',   color: '#2196f3', icon: 'M' },
  test:  { label: 'test',    color: '#b388ff', icon: 'T' },
  other: { label: 'altro',   color: '#607d8b', icon: '*' },
}

const FILTERS: { key: 'all' | CommitType; label: string }[] = [
  { key: 'all',   label: 'tutti' },
  { key: 'feat',  label: 'feature' },
  { key: 'fix',   label: 'fix' },
  { key: 'merge', label: 'merge' },
  { key: 'test',  label: 'test' },
]

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return iso }
}

/** Rimuove prefisso convenzionale (feat(scope): fix: merge: ecc) per mostrare solo il messaggio */
function cleanMessage(msg: string): string {
  return msg.replace(/^(?:feat|fix|merge|test|refactor|chore|docs|style|perf|ci|build)\([^)]*\):\s*/i, '')
            .replace(/^(?:feat|fix|merge|test|refactor|chore|docs|style|perf|ci|build):\s*/i, '')
}

export default function ChangelogPage() {
  const [data, setData] = useState<ChangelogRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | CommitType>('all')

  useEffect(() => {
    fetch('/api/changelog')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d) })
      .finally(() => setLoading(false))
  }, [])

  const filteredDays: DayGroup[] = (data?.days ?? [])
    .map(day => ({
      ...day,
      commits: filter === 'all' ? day.commits : day.commits.filter(c => c.type === filter),
    }))
    .filter(day => day.commits.length > 0)

  const totalFiltered = filteredDays.reduce((s, d) => s + d.commits.length, 0)

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Changelog</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Changelog</h1>
          {data && (
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {totalFiltered} modifiche{filter !== 'all' ? ` (${TYPE_CFG[filter].label})` : ''} su {data.days.length} giorni
            </p>
          )}
        </div>

        {/* Filtri */}
        <div className="flex gap-1.5 mt-4 flex-wrap" role="radiogroup" aria-label="Filtra per tipo">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              role="radio" aria-checked={filter === f.key}
              className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
              style={{
                border: `1px solid ${filter === f.key ? 'var(--color-green)' : 'var(--color-border)'}`,
                color: filter === f.key ? 'var(--color-green)' : 'var(--color-dim)',
                background: filter === f.key ? 'rgba(0,232,122,0.08)' : 'transparent',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <span className="text-[var(--color-dim)] text-[12px]">Caricamento...</span>
        </div>
      )}

      {/* Empty */}
      {!loading && filteredDays.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="text-[var(--color-dim)] text-3xl">~</span>
          <p className="text-[12px] font-semibold text-[var(--color-muted)]">Nessuna modifica trovata</p>
        </div>
      )}

      {/* Timeline */}
      {!loading && filteredDays.length > 0 && (
        <div className="flex flex-col gap-6">
          {filteredDays.map(day => (
            <div key={day.date}>
              {/* Data header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-2 h-2 rounded-full bg-[var(--color-green)] flex-shrink-0" />
                <span className="text-[12px] font-semibold text-[var(--color-bright)] capitalize">
                  {formatDate(day.date)}
                </span>
                <span className="text-[10px] text-[var(--color-dim)]">
                  {day.commits.length} {day.commits.length === 1 ? 'modifica' : 'modifiche'}
                </span>
              </div>

              {/* Commit list */}
              <div className="ml-1 pl-4 border-l border-[var(--color-border)] flex flex-col gap-1">
                {day.commits.map(commit => {
                  const cfg = TYPE_CFG[commit.type]
                  return (
                    <div key={commit.hash} className="flex items-start gap-2.5 py-1.5">
                      <span
                        className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-px"
                        style={{
                          color: cfg.color,
                          border: `1px solid ${cfg.color}33`,
                          background: `${cfg.color}0d`,
                        }}
                      >
                        {cfg.icon}
                      </span>
                      <span className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                        {cleanMessage(commit.message)}
                      </span>
                      <span className="text-[9px] font-mono text-[var(--color-dim)] ml-auto flex-shrink-0 mt-0.5">
                        {commit.hash}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
