'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Priority = 'low' | 'normal' | 'high' | 'urgent'
type NType = 'info' | 'warning' | 'success' | 'error'
type Channel = 'desktop' | 'telegram' | 'web'
type Notif = { id: string; type: NType; channel: Channel; title: string; body: string; priority: Priority; timestamp: number; read: boolean; agentId?: string }

const TYPE_CFG: Record<NType, { label: string; color: string; icon: string }> = {
  info:    { label: 'info',    color: '#61affe', icon: 'ℹ' },
  warning: { label: 'avviso',  color: 'var(--color-yellow)', icon: '⚠' },
  success: { label: 'ok',      color: 'var(--color-green)', icon: '✓' },
  error:   { label: 'errore',  color: 'var(--color-red)', icon: '✗' },
}

const PRIO_CFG: Record<Priority, { label: string; color: string }> = {
  low: { label: 'bassa', color: 'var(--color-dim)' }, normal: { label: 'normale', color: 'var(--color-muted)' },
  high: { label: 'alta', color: 'var(--color-yellow)' }, urgent: { label: 'urgente', color: 'var(--color-red)' },
}

function NotifRow({ n, onRead, onDelete }: { n: Notif; onRead: (id: string) => void; onDelete: (id: string) => void }) {
  const age = Math.floor((Date.now() - n.timestamp) / 60000)
  const ageLabel = age < 1 ? 'adesso' : age < 60 ? `${age}m fa` : age < 1440 ? `${Math.floor(age / 60)}h fa` : `${Math.floor(age / 1440)}g fa`
  const t = TYPE_CFG[n.type] ?? TYPE_CFG.info
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
      style={{ opacity: n.read ? 0.5 : 1 }}>
      <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold" aria-hidden="true"
        style={{ background: `${t.color}18`, color: t.color }}>{t.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          {!n.read && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-green)', flexShrink: 0 }} />}
          <span className="text-[12px] font-semibold text-[var(--color-bright)]">{n.title}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ color: t.color, background: `${t.color}12`, border: `1px solid ${t.color}30` }}>{t.label}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ color: PRIO_CFG[n.priority].color, border: `1px solid var(--color-border)` }}>{PRIO_CFG[n.priority].label}</span>
        </div>
        <p className="text-[11px] text-[var(--color-muted)] truncate">{n.body}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[9px] text-[var(--color-dim)]">{ageLabel}</span>
        {!n.read && <Btn label="letto" color="var(--color-green)" onClick={() => onRead(n.id)} />}
        <Btn label="×" color="var(--color-red)" onClick={() => onDelete(n.id)} ariaLabel="Elimina notifica" />
      </div>
    </div>
  )
}

function Btn({ label, color, onClick, ariaLabel, ...rest }: { label: string; color: string; onClick: () => void; ariaLabel?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button onClick={onClick} aria-label={ariaLabel} className="text-[10px] font-bold transition-colors cursor-pointer"
      style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}
      onMouseEnter={e => e.currentTarget.style.color = color}
      onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'} {...rest}>{label}</button>
  )
}

type FilterType = 'all' | NType
type FilterRead = 'all' | 'unread' | 'read'

export default function NotificationsPage() {
  const [items, setItems] = useState<Notif[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterRead, setFilterRead] = useState<FilterRead>('all')

  const fetchNotifs = useCallback(async () => {
    const p = new URLSearchParams()
    if (filterType !== 'all') p.set('type', filterType)
    if (filterRead === 'unread') p.set('unread', 'true')
    const q = p.toString() ? `?${p}` : ''
    const res = await fetch(`/api/notifications${q}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    let notifs = data.notifications ?? []
    if (filterRead === 'read') notifs = notifs.filter((n: Notif) => n.read)
    setItems(notifs)
    setUnreadCount(data.unreadCount ?? 0)
  }, [filterType, filterRead])

  useEffect(() => { fetchNotifs() }, [fetchNotifs])
  useEffect(() => { const id = setInterval(fetchNotifs, 5000); return () => clearInterval(id) }, [fetchNotifs])

  const markRead = async (id: string) => { await fetch(`/api/notifications?id=${id}`, { method: 'PATCH' }); fetchNotifs() }
  const markAllRead = async () => { await fetch('/api/notifications?all=true', { method: 'PATCH' }); fetchNotifs() }
  const deleteOne = async (id: string) => { await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' }); fetchNotifs() }
  const deleteRead = async () => { await fetch('/api/notifications?read=true', { method: 'DELETE' }); fetchNotifs() }

  const TYPE_FILTERS: Array<{ key: FilterType; label: string; color?: string }> = [
    { key: 'all', label: 'tutte' },
    { key: 'info', label: 'info', color: TYPE_CFG.info.color },
    { key: 'success', label: 'ok', color: TYPE_CFG.success.color },
    { key: 'warning', label: 'avvisi', color: TYPE_CFG.warning.color },
    { key: 'error', label: 'errori', color: TYPE_CFG.error.color },
  ]
  const READ_FILTERS: Array<{ key: FilterRead; label: string }> = [
    { key: 'all', label: 'tutte' }, { key: 'unread', label: 'non lette' }, { key: 'read', label: 'lette' },
  ]

  const readCount = items.filter(n => n.read).length

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Notifiche</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Notifiche</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{unreadCount} non lette · {items.length} totali</p>
          </div>
          <div className="flex gap-2">
            {readCount > 0 && (
              <button onClick={deleteRead} className="px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide cursor-pointer transition-all"
                style={{ border: '1px solid rgba(255,69,96,0.3)', color: 'var(--color-red)', background: 'transparent' }}>
                elimina lette ({readCount})
              </button>
            )}
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide cursor-pointer transition-all"
                style={{ background: 'var(--color-green)', color: '#000', border: 'none' }}>
                segna tutte lette
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex gap-1">
          {TYPE_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilterType(f.key)}
              className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
              style={{ background: filterType === f.key ? 'var(--color-row)' : 'transparent',
                color: filterType === f.key ? (f.color ?? 'var(--color-bright)') : 'var(--color-dim)',
                border: `1px solid ${filterType === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {READ_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilterRead(f.key)}
              className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
              style={{ background: filterRead === f.key ? 'var(--color-row)' : 'transparent',
                color: filterRead === f.key ? 'var(--color-bright)' : 'var(--color-dim)',
                border: `1px solid ${filterRead === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {items.length === 0
          ? <div className="flex flex-col items-center py-16"><p className="text-[var(--color-dim)] text-[12px]">Nessuna notifica trovata.</p></div>
          : items.map(n => <NotifRow key={n.id} n={n} onRead={markRead} onDelete={deleteOne} />)
        }
      </div>
    </div>
  )
}
