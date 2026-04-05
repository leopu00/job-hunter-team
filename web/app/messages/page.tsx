'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type ThreadSummary = { id: string; contact: string; company: string; starred: boolean; lastMessage: string; lastTimestamp: number; unread: boolean; messageCount: number }
type Message = { id: string; body: string; fromMe: boolean; timestamp: number }
type Thread = { id: string; contact: string; company: string; starred: boolean; messages: Message[] }
type Filter = 'all' | 'unread' | 'starred'

function fmtTime(ts: number) {
  const d = new Date(ts), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

export default function MessagesPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [activeThread, setActiveThread] = useState<Thread | null>(null)
  const [reply, setReply] = useState('')
  const [showCompose, setShowCompose] = useState(false)
  const [newContact, setNewContact] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [newBody, setNewBody] = useState('')

  const fetchThreads = useCallback(async () => {
    const p = new URLSearchParams()
    if (filter !== 'all') p.set('filter', filter)
    const res = await fetch(`/api/messages?${p}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setThreads(data.threads ?? []); setUnreadCount(data.unreadCount ?? 0)
  }, [filter])

  useEffect(() => { fetchThreads() }, [fetchThreads])

  const openThread = async (id: string) => {
    const res = await fetch(`/api/messages?threadId=${id}`).catch(() => null)
    if (!res?.ok) return
    setActiveThread((await res.json()).thread); setShowCompose(false)
  }

  const sendReply = async () => {
    if (!reply.trim() || !activeThread) return
    await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: activeThread.id, body: reply.trim() }) })
    setReply(''); openThread(activeThread.id)
  }

  const sendNew = async () => {
    if (!newContact.trim() || !newCompany.trim() || !newBody.trim()) return
    await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact: newContact.trim(), company: newCompany.trim(), body: newBody.trim() }) })
    setNewContact(''); setNewCompany(''); setNewBody(''); setShowCompose(false); fetchThreads()
  }

  const FILTERS: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: 'tutti' }, { key: 'unread', label: 'non letti' }, { key: 'starred', label: 'preferiti' },
  ]

  const inputCls = "text-[11px] px-3 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)]"

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Messaggi</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Messaggi</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{threads.length} conversazioni{unreadCount > 0 && ` · ${unreadCount} non letti`}</p>
          </div>
          <button onClick={() => { setShowCompose(!showCompose); setActiveThread(null) }} className="px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer"
            style={{ background: showCompose ? 'transparent' : 'var(--color-green)', color: showCompose ? 'var(--color-muted)' : '#000', border: showCompose ? '1px solid var(--color-border)' : 'none' }}>
            {showCompose ? 'annulla' : '+ nuovo messaggio'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => { setFilter(f.key); setActiveThread(null) }}
            className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
            style={{ background: filter === f.key ? 'var(--color-row)' : 'transparent', color: filter === f.key ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filter === f.key ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {f.label}
          </button>
        ))}
      </div>

      {showCompose && (
        <div className="mb-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Nuovo messaggio</p>
          <div className="flex flex-wrap gap-2 mb-2">
            <input value={newContact} onChange={e => setNewContact(e.target.value)} placeholder="Contatto *" aria-label="Contatto" className={`${inputCls} flex-1 min-w-[140px]`} />
            <input value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="Azienda *" aria-label="Azienda" className={`${inputCls} min-w-[120px]`} />
          </div>
          <div className="flex gap-2">
            <input value={newBody} onChange={e => setNewBody(e.target.value)} placeholder="Scrivi messaggio..." aria-label="Messaggio" className={`${inputCls} flex-1`}
              onKeyDown={e => e.key === 'Enter' && sendNew()} />
            <button onClick={sendNew} className="px-4 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
              style={{ background: 'var(--color-green)', color: '#000', border: 'none' }}>invia</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-5 gap-4">
        <div className="md:col-span-2 border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          {threads.length === 0 ? (
            <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna conversazione.</p></div>
          ) : threads.map(t => (
            <div key={t.id} role="button" tabIndex={0} onClick={() => { openThread(t.id); setShowCompose(false) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread(t.id); setShowCompose(false); } }}
              className="px-4 py-3 border-b border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-row)] transition-colors"
              style={{ background: activeThread?.id === t.id ? 'var(--color-row)' : undefined }}>
              <div className="flex items-center gap-2">
                {t.unread && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--color-green)' }} />}
                <span className="text-[12px] font-semibold text-[var(--color-bright)] flex-1 truncate">{t.contact}</span>
                {t.starred && <span className="text-[10px]">⭐</span>}
                <span className="text-[9px] text-[var(--color-dim)]">{fmtTime(t.lastTimestamp)}</span>
              </div>
              <p className="text-[9px] text-[var(--color-dim)] mt-0.5">{t.company}</p>
              <p className="text-[10px] text-[var(--color-muted)] truncate mt-0.5">{t.lastMessage}</p>
            </div>
          ))}
        </div>

        <div className="md:col-span-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] flex flex-col" style={{ minHeight: 300 }}>
          {!activeThread ? (
            <div className="flex-1 flex items-center justify-center"><p className="text-[var(--color-dim)] text-[12px]">Seleziona una conversazione</p></div>
          ) : (<>
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <span className="text-[12px] font-semibold text-[var(--color-bright)]">{activeThread.contact}</span>
              <span className="text-[10px] text-[var(--color-dim)] ml-2">@ {activeThread.company}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
              {activeThread.messages.map(m => (
                <div key={m.id} className={`max-w-[80%] px-3 py-2 rounded-lg text-[11px] ${m.fromMe ? 'self-end' : 'self-start'}`}
                  style={{ background: m.fromMe ? 'rgba(0,232,122,0.12)' : 'var(--color-row)', color: 'var(--color-bright)' }}>
                  <p>{m.body}</p>
                  <p className="text-[8px] text-[var(--color-dim)] mt-1 text-right">{fmtTime(m.timestamp)}</p>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-[var(--color-border)] flex gap-2">
              <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Rispondi..." className={`${inputCls} flex-1`}
                onKeyDown={e => e.key === 'Enter' && sendReply()} />
              <button onClick={sendReply} className="px-4 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
                style={{ background: 'var(--color-green)', color: '#000', border: 'none' }}>invia</button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}
