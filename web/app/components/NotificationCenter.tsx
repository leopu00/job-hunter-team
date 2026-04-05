'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

/* ── Types ────────────────────────────────────────────────────────── */

export type NotificationType = 'agent_start' | 'agent_stop' | 'task_done' | 'error' | 'info'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  timestamp: number
  read: boolean
}

/* ── i18n ─────────────────────────────────────────────────────────── */

type Lang = 'it' | 'en'

const I18N: Record<Lang, Record<string, string>> = {
  it: {
    title: 'Notifiche',
    mark_all: 'Segna tutte lette',
    empty: 'Nessuna notifica',
    clear: 'Cancella tutto',
  },
  en: {
    title: 'Notifications',
    mark_all: 'Mark all read',
    empty: 'No notifications',
    clear: 'Clear all',
  },
}

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'it'
  const stored = localStorage.getItem('jht-lang')
  if (stored === 'en' || stored === 'it') return stored
  return navigator.language.startsWith('en') ? 'en' : 'it'
}

/* ── Config ───────────────────────────────────────────────────────── */

const STORAGE_KEY = 'jht-notifications'
const MAX_ITEMS = 50

const TYPE_CFG: Record<NotificationType, { icon: string; color: string }> = {
  agent_start: { icon: '▶', color: 'var(--color-green)' },
  agent_stop:  { icon: '■', color: 'var(--color-yellow)' },
  task_done:   { icon: '✓', color: 'var(--color-green)' },
  error:       { icon: '✗', color: 'var(--color-red)' },
  info:        { icon: 'i', color: 'var(--color-blue)' },
}

/* ── Storage helpers ──────────────────────────────────────────────── */

function loadNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveNotifications(items: AppNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
  } catch { /* quota exceeded */ }
}

/* ── Public API: dispatch from anywhere ───────────────────────────── */

const listeners = new Set<() => void>()

export function pushNotification(type: NotificationType, title: string, body: string = '') {
  const item: AppNotification = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type, title, body,
    timestamp: Date.now(),
    read: false,
  }
  const items = [item, ...loadNotifications()].slice(0, MAX_ITEMS)
  saveNotifications(items)
  listeners.forEach((fn) => fn())
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function timeAgo(ts: number, lang: Lang): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  const suffix = lang === 'it' ? ' fa' : ' ago'
  if (diff < 60)    return `${diff}s${suffix}`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m${suffix}`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h${suffix}`
  return `${Math.floor(diff / 86400)}d${suffix}`
}

/* ── Component ────────────────────────────────────────────────────── */

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const lang = detectLang()
  const t = I18N[lang]

  const reload = useCallback(() => setItems(loadNotifications()), [])

  // Load on mount + listen for pushes
  useEffect(() => {
    reload()
    listeners.add(reload)
    return () => { listeners.delete(reload) }
  }, [reload])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const unread = items.filter((n) => !n.read).length

  const markRead = useCallback((id?: string) => {
    setItems((prev) => {
      const next = prev.map((n) =>
        id ? (n.id === id ? { ...n, read: true } : n) : { ...n, read: true },
      )
      saveNotifications(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setItems([])
    saveNotifications([])
  }, [])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Bell button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center w-8 h-8 rounded transition-colors cursor-pointer"
        style={{
          background: open ? 'var(--color-card)' : 'transparent',
          border: `1px solid ${open ? 'var(--color-border)' : 'transparent'}`,
        }}
        aria-label={t.title}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6v2.5L2 10v1h12v-1l-1.5-1.5V6c0-2.5-2-4.5-4.5-4.5zM6.5 12a1.5 1.5 0 003 0"
            stroke="var(--color-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] rounded-full text-[8px] font-bold font-mono px-0.5"
            style={{ background: 'var(--color-red)', color: 'white' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-lg overflow-hidden z-50"
          style={{
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            animation: 'fade-in 0.15s ease both',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <p className="text-[11px] font-bold" style={{ color: 'var(--color-white)' }}>
              {t.title} {unread > 0 && <span style={{ color: 'var(--color-red)' }}>({unread})</span>}
            </p>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button
                  onClick={() => markRead()}
                  className="text-[9px] cursor-pointer"
                  style={{ color: 'var(--color-dim)', background: 'none', border: 'none', fontFamily: 'inherit' }}
                >
                  {t.mark_all}
                </button>
              )}
              {items.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-[9px] cursor-pointer"
                  style={{ color: 'var(--color-dim)', background: 'none', border: 'none', fontFamily: 'inherit' }}
                >
                  {t.clear}
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-[10px] text-center" style={{ color: 'var(--color-dim)' }}>
                {t.empty}
              </p>
            ) : (
              items.slice(0, 20).map((n) => {
                const cfg = TYPE_CFG[n.type]
                return (
                  <div
                    key={n.id}
                    role={n.read ? undefined : 'button'}
                    tabIndex={n.read ? undefined : 0}
                    aria-label={n.read ? undefined : `Segna come letta: ${n.title}`}
                    onClick={() => !n.read && markRead(n.id)}
                    onKeyDown={e => { if (!n.read && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); markRead(n.id) } }}
                    className="flex gap-3 px-4 py-3 cursor-pointer transition-colors border-b"
                    style={{
                      borderColor: 'var(--color-border)',
                      background: n.read ? 'transparent' : 'rgba(77,159,255,0.04)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-deep)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(77,159,255,0.04)' }}
                  >
                    <span
                      className="flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold flex-shrink-0 mt-0.5"
                      style={{ color: cfg.color, background: `${cfg.color}15`, border: `1px solid ${cfg.color}30` }}
                    >
                      {cfg.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[11px] font-semibold truncate"
                        style={{ color: n.read ? 'var(--color-muted)' : 'var(--color-white)' }}
                      >
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-[10px] line-clamp-2 mt-0.5" style={{ color: 'var(--color-dim)' }}>
                          {n.body}
                        </p>
                      )}
                      <p className="text-[9px] mt-0.5" style={{ color: 'var(--color-dim)' }}>
                        {timeAgo(n.timestamp, lang)}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
