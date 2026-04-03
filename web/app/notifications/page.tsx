'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Priority = 'low' | 'normal' | 'high' | 'urgent'
type Channel = 'desktop' | 'telegram' | 'web'
type Notif = { id: string; channel: Channel; title: string; body: string; priority: Priority; timestamp: number; read: boolean; agentId?: string }

const PRIO_CFG: Record<Priority, { label: string; color: string; bg: string; border: string }> = {
  low:    { label: 'bassa',   color: 'var(--color-dim)',    bg: 'transparent',            border: 'var(--color-border)' },
  normal: { label: 'normale', color: 'var(--color-muted)',  bg: 'transparent',            border: 'var(--color-border)' },
  high:   { label: 'alta',    color: 'var(--color-yellow)', bg: 'rgba(245,197,24,0.08)',  border: 'rgba(245,197,24,0.3)' },
  urgent: { label: 'urgente', color: 'var(--color-red)',    bg: 'rgba(255,69,96,0.08)',   border: 'rgba(255,69,96,0.3)' },
}

const CH_LABEL: Record<Channel, string> = { desktop: 'Desktop', telegram: 'Telegram', web: 'Web' }

function PrioBadge({ priority }: { priority: Priority }) {
  const c = PRIO_CFG[priority]
  return <span className="badge" style={{ color: c.color, background: c.bg, border: `1px solid ${c.border}`, fontSize: 9 }}>{c.label}</span>
}

function NotifRow({ n, onRead }: { n: Notif; onRead: (id: string) => void }) {
  const age = Math.floor((Date.now() - n.timestamp) / 60000)
  const ageLabel = age < 1 ? 'adesso' : age < 60 ? `${age}m fa` : `${Math.floor(age / 60)}h fa`
  return (
    <div className="flex items-start gap-4 px-5 py-3.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
      style={{ opacity: n.read ? 0.5 : 1 }}>
      {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-green)', marginTop: 6, flexShrink: 0 }} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-[12px] font-semibold text-[var(--color-bright)]">{n.title}</span>
          <PrioBadge priority={n.priority} />
          <span className="text-[9px] font-mono text-[var(--color-dim)]">{CH_LABEL[n.channel]}</span>
          {n.agentId && <span className="text-[9px] font-mono text-[var(--color-dim)]">{n.agentId}</span>}
        </div>
        <p className="text-[11px] text-[var(--color-muted)] truncate">{n.body}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-[10px] text-[var(--color-dim)]">{ageLabel}</span>
        {!n.read && (
          <button onClick={() => onRead(n.id)}
            className="text-[10px] font-semibold tracking-wide transition-colors cursor-pointer"
            style={{ color: 'var(--color-dim)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--color-green)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>
            letto
          </button>
        )}
      </div>
    </div>
  )
}

type FilterPrio = 'all' | Priority
type FilterRead = 'all' | 'unread' | 'read'

export default function NotificationsPage() {
  const [items, setItems] = useState<Notif[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [filterPrio, setFilterPrio] = useState<FilterPrio>('all')
  const [filterRead, setFilterRead] = useState<FilterRead>('all')

  const fetchNotifs = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterPrio !== 'all') params.set('priority', filterPrio)
    if (filterRead === 'unread') params.set('unread', 'true')
    const q = params.toString() ? `?${params}` : ''
    const res = await fetch(`/api/notifications${q}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    let notifs = data.notifications ?? []
    if (filterRead === 'read') notifs = notifs.filter((n: Notif) => n.read)
    setItems(notifs)
    setUnreadCount(data.unreadCount ?? 0)
  }, [filterPrio, filterRead])

  useEffect(() => { fetchNotifs() }, [fetchNotifs])
  useEffect(() => { const id = setInterval(fetchNotifs, 5000); return () => clearInterval(id) }, [fetchNotifs])

  const markRead = async (id: string) => {
    await fetch(`/api/notifications?id=${id}`, { method: 'PATCH' }).catch(() => null)
    fetchNotifs()
  }

  const markAllRead = async () => {
    await fetch('/api/notifications?all=true', { method: 'PATCH' }).catch(() => null)
    fetchNotifs()
  }

  const PRIO_FILTERS: Array<{ key: FilterPrio; label: string }> = [
    { key: 'all', label: 'tutte' }, { key: 'urgent', label: 'urgenti' }, { key: 'high', label: 'alte' },
    { key: 'normal', label: 'normali' }, { key: 'low', label: 'basse' },
  ]
  const READ_FILTERS: Array<{ key: FilterRead; label: string }> = [
    { key: 'all', label: 'tutte' }, { key: 'unread', label: 'non lette' }, { key: 'read', label: 'lette' },
  ]

  const FilterBar = ({ filters, active, onChange }: { filters: Array<{ key: string; label: string }>; active: string; onChange: (k: any) => void }) => (
    <div className="flex gap-1">
      {filters.map(f => (
        <button key={f.key} onClick={() => onChange(f.key)}
          className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
          style={{ background: active === f.key ? 'var(--color-row)' : 'transparent', color: active === f.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${active === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
          {f.label}
        </button>
      ))}
    </div>
  )

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Notifiche</span>
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Notifiche</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{unreadCount} non lette · {items.length} totali</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={markAllRead}
              className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer"
              style={{ background: 'var(--color-green)', color: '#000' }}>
              segna tutte lette
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-4">
        <FilterBar filters={PRIO_FILTERS} active={filterPrio} onChange={setFilterPrio} />
        <FilterBar filters={READ_FILTERS} active={filterRead} onChange={setFilterRead} />
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {items.length === 0
          ? <div className="flex flex-col items-center py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna notifica trovata.</p></div>
          : items.map(n => <NotifRow key={n.id} n={n} onRead={markRead} />)
        }
      </div>
    </div>
  )
}
