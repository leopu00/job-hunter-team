'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type ActivityType = 'merge' | 'pr' | 'task' | 'test' | 'forum' | 'deploy'
type ActivityItem = { id: string; type: ActivityType; title: string; description?: string; actor?: string; at: number }
type ActivityRes  = { items: ActivityItem[]; total: number; page: number; pages: number }

const TYPE_ICON: Record<ActivityType, string> = {
  merge: '🔀', pr: '📬', task: '📋', test: '🧪', forum: '💬', deploy: '🚀',
}
const TYPE_COLOR: Record<ActivityType, string> = {
  merge: 'var(--color-green)', pr: 'var(--color-yellow)', task: 'var(--color-muted)',
  test: 'var(--color-green)', forum: 'var(--color-dim)', deploy: 'var(--color-orange)',
}
const TYPE_LABEL: Record<ActivityType, string> = {
  merge: 'merge', pr: 'PR', task: 'task', test: 'test', forum: 'forum', deploy: 'deploy',
}
const FILTERS: Array<{ key: 'all' | ActivityType; label: string }> = [
  { key: 'all', label: 'tutto' }, { key: 'merge', label: 'merge' }, { key: 'pr', label: 'PR' },
  { key: 'task', label: 'task' }, { key: 'test', label: 'test' }, { key: 'forum', label: 'forum' },
]

function fmtTime(ms: number) {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'adesso'
  if (m < 60) return `${m}m fa`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h fa`
  return new Date(ms).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

function TimelineDot({ type }: { type: ActivityType }) {
  return (
    <div className="flex flex-col items-center flex-shrink-0" style={{ width: 32 }}>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0"
        style={{ background: `${TYPE_COLOR[type]}18`, border: `1px solid ${TYPE_COLOR[type]}44` }}>
        {TYPE_ICON[type]}
      </div>
    </div>
  )
}

export default function ActivityPage() {
  const [data, setData]     = useState<ActivityRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | ActivityType>('all')
  const [page, setPage]     = useState(1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const q = new URLSearchParams({ page: String(page), limit: '20', type: filter })
    const res = await fetch(`/api/activity?${q}`).catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [page, filter])

  useEffect(() => { fetchData() }, [fetchData])

  const onFilter = (f: typeof filter) => { setFilter(f); setPage(1) }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Attività</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Attività team</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">{data ? `${data.total} eventi totali` : '…'}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap mt-4">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => onFilter(f.key)}
              className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
              style={{ border: `1px solid ${filter === f.key ? 'var(--color-green)' : 'var(--color-border)'}`, color: filter === f.key ? 'var(--color-green)' : 'var(--color-dim)', background: filter === f.key ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="flex justify-center py-16" role="status" aria-live="polite"><span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span></div>}

      {!loading && data && data.items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="text-4xl">📭</span>
          <p className="text-[12px] font-semibold text-[var(--color-muted)]">Nessuna attività</p>
          <p className="text-[10px] text-[var(--color-dim)]">L&apos;attività del team apparirà qui.</p>
        </div>
      )}

      {!loading && data && data.items.length > 0 && (
        <div className="flex flex-col gap-0">
          {data.items.map((item, i) => (
            <div key={item.id} className="flex gap-3 group">
              <div className="flex flex-col items-center">
                <TimelineDot type={item.type} />
                {i < data.items.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: 'var(--color-border)', minHeight: 20 }} />}
              </div>
              <div className="flex-1 pb-5 pt-0.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="badge text-[9px]" style={{ color: TYPE_COLOR[item.type], background: `${TYPE_COLOR[item.type]}12`, border: `1px solid ${TYPE_COLOR[item.type]}33` }}>
                        {TYPE_LABEL[item.type]}
                      </span>
                      {item.actor && <span className="text-[9px] text-[var(--color-dim)] font-mono">{item.actor}</span>}
                    </div>
                    <p className="text-[12px] text-[var(--color-bright)] leading-snug">{item.title}</p>
                    {item.description && <p className="text-[10px] text-[var(--color-dim)] mt-0.5 truncate">{item.description}</p>}
                  </div>
                  <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0 mt-0.5">{fmtTime(item.at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--color-border)]">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-4 py-2 rounded text-[10px] font-semibold transition-colors"
            style={{ border: '1px solid var(--color-border)', color: page <= 1 ? 'var(--color-border)' : 'var(--color-muted)', cursor: page <= 1 ? 'default' : 'pointer', background: 'transparent' }}>
            ← precedente
          </button>
          <span className="text-[10px] text-[var(--color-dim)]">pag. {page} / {data.pages}</span>
          <button disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}
            className="px-4 py-2 rounded text-[10px] font-semibold transition-colors"
            style={{ border: '1px solid var(--color-border)', color: page >= data.pages ? 'var(--color-border)' : 'var(--color-muted)', cursor: page >= data.pages ? 'default' : 'pointer', background: 'transparent' }}>
            successiva →
          </button>
        </div>
      )}
    </div>
  )
}
