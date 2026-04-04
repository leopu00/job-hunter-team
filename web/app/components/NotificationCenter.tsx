'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

type Notification = { id: string; title: string; body: string; priority: string; timestamp: number; read: boolean; agentId?: string }

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'var(--color-red)', high: 'var(--color-yellow)',
  normal: 'var(--color-blue)', low: 'var(--color-dim)',
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60)    return `${diff}s fa`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m fa`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`
  return `${Math.floor(diff / 86400)}g fa`
}

export function NotificationCenter() {
  const [open,    setOpen]    = useState(false)
  const [items,   setItems]   = useState<Notification[]>([])
  const [unread,  setUnread]  = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    fetch('/api/notifications?unread=false').then(r => r.json()).then(d => {
      const sorted = (d.notifications ?? []).sort((a: Notification, b: Notification) => b.timestamp - a.timestamp).slice(0, 10)
      setItems(sorted)
      setUnread(d.unreadCount ?? 0)
    }).catch(() => {})
  }, [])

  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id) }, [load])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const markRead = useCallback(async (id?: string) => {
    const qs = id ? `?id=${id}` : '?all=true'
    await fetch(`/api/notifications${qs}`, { method: 'PATCH' })
    setItems(prev => prev.map(n => id ? (n.id === id ? { ...n, read: true } : n) : { ...n, read: true }))
    setUnread(id ? (u => Math.max(0, u - 1)) : 0)
  }, [])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Bell button */}
      <button onClick={() => setOpen(o => !o)}
        className="relative flex items-center justify-center w-7 h-7 rounded transition-colors cursor-pointer"
        style={{ background: open ? 'var(--color-card)' : 'transparent', border: '1px solid ' + (open ? 'var(--color-border)' : 'transparent') }}
        aria-label="Notifiche">
        <span style={{ fontSize: 14 }}>🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold font-mono"
            style={{ background: 'var(--color-red)', color: 'white' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden z-50"
          style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-[11px] font-bold" style={{ color: 'var(--color-white)' }}>
              Notifiche {unread > 0 && <span style={{ color: 'var(--color-red)' }}>({unread})</span>}
            </p>
            {unread > 0 && (
              <button onClick={() => markRead()} className="text-[9px] cursor-pointer"
                style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}>
                Segna tutte lette
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-[10px] text-center" style={{ color: 'var(--color-dim)' }}>Nessuna notifica</p>
            ) : items.map(n => (
              <div key={n.id} onClick={() => !n.read && markRead(n.id)}
                className="flex gap-3 px-4 py-3 cursor-pointer transition-colors border-b"
                style={{ borderColor: 'var(--color-border)', background: n.read ? 'transparent' : 'rgba(77,159,255,0.04)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-deep)' }}
                onMouseLeave={e => { e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(77,159,255,0.04)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLOR[n.priority] ?? 'var(--color-dim)', flexShrink: 0, marginTop: 5 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold truncate" style={{ color: n.read ? 'var(--color-muted)' : 'var(--color-white)' }}>{n.title}</p>
                  <p className="text-[10px] line-clamp-1" style={{ color: 'var(--color-dim)' }}>{n.body}</p>
                  <p className="text-[9px] mt-0.5" style={{ color: 'var(--color-dim)' }}>{timeAgo(n.timestamp)}{n.agentId ? ` · ${n.agentId}` : ''}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <Link href="/notifications" onClick={() => setOpen(false)}
              className="text-[10px] no-underline" style={{ color: 'var(--color-green)' }}>
              Vedi tutte le notifiche →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
