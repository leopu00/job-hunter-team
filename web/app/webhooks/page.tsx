'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type WebhookEvent = 'task.completed' | 'task.failed' | 'session.started' | 'session.ended' | 'agent.started' | 'agent.stopped' | 'backup.completed' | 'deploy.completed'
type Webhook = { id: string; name: string; url: string; events: WebhookEvent[]; enabled: boolean; secret?: string; createdAt: number; lastTriggeredAt?: number; lastStatus?: number }

const ALL_EVENTS: WebhookEvent[] = ['task.completed','task.failed','session.started','session.ended','agent.started','agent.stopped','backup.completed','deploy.completed']

function fmtDate(ms?: number) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

function StatusPill({ status }: { status?: number }) {
  if (!status) return <span className="text-[9px] text-[var(--color-dim)]">—</span>
  const ok = status >= 200 && status < 300
  return <span className="text-[9px] font-mono" style={{ color: ok ? 'var(--color-green)' : 'var(--color-red)' }}>{status}</span>
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName]   = useState('')
  const [url, setUrl]     = useState('')
  const [secret, setSecret] = useState('')
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [creating, setCreating] = useState(false)
  const [pinging, setPinging]   = useState<string | null>(null)
  const [pingResult, setPingResult] = useState<Record<string, { ok: boolean; status?: number }>>({})

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/webhooks').catch(() => null)
    if (res?.ok) { const d = await res.json(); setWebhooks(d.webhooks ?? []) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const toggle = async (wh: Webhook) => {
    await fetch('/api/webhooks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: wh.id, enabled: !wh.enabled }) }).catch(() => null)
    fetchData()
  }

  const del = async (id: string) => {
    await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE' }).catch(() => null)
    setWebhooks(prev => prev.filter(w => w.id !== id))
  }

  const ping = async (id: string) => {
    setPinging(id)
    const res = await fetch('/api/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) }).catch(() => null)
    if (res) { const d = await res.json(); setPingResult(prev => ({ ...prev, [id]: { ok: d.ok, status: d.status } })) }
    setPinging(null)
    fetchData()
  }

  const create = async () => {
    if (!name.trim() || !url.trim()) return
    setCreating(true)
    await fetch('/api/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), url: url.trim(), events, secret: secret.trim() || undefined }) }).catch(() => null)
    setName(''); setUrl(''); setSecret(''); setEvents([]); setShowForm(false); setCreating(false)
    fetchData()
  }

  const toggleEvent = (e: WebhookEvent) => setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Webhook</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Webhook</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{webhooks.filter(w => w.enabled).length} attivi · {webhooks.length} totali</p>
          </div>
          <button onClick={() => setShowForm(v => !v)} className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all"
            style={{ background: showForm ? 'var(--color-border)' : 'var(--color-green)', color: showForm ? 'var(--color-muted)' : '#000', cursor: 'pointer' }}>
            {showForm ? '✕ annulla' : '+ nuovo webhook'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]" style={{ animation: 'fade-in 0.2s ease both' }}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome…" aria-label="Nome webhook" className="flex-1 text-[12px]" style={{ color: 'var(--color-bright)' }} />
              <input value={secret} onChange={e => setSecret(e.target.value)} placeholder="Secret HMAC (opzionale)" aria-label="Secret HMAC" className="flex-1 text-[12px]" style={{ color: 'var(--color-bright)' }} />
            </div>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="https://…" aria-label="URL webhook" className="text-[12px]" style={{ color: 'var(--color-bright)' }} />
            <div className="flex flex-wrap gap-1.5">
              {ALL_EVENTS.map(ev => (
                <button key={ev} onClick={() => toggleEvent(ev)} className="px-2 py-1 rounded text-[9px] font-mono cursor-pointer transition-all"
                  style={{ border: `1px solid ${events.includes(ev) ? 'var(--color-green)' : 'var(--color-border)'}`, color: events.includes(ev) ? 'var(--color-green)' : 'var(--color-dim)', background: events.includes(ev) ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
                  {ev}
                </button>
              ))}
            </div>
            <button onClick={create} disabled={!name.trim() || !url.trim() || creating}
              className="self-end px-5 py-2 rounded-lg text-[11px] font-bold"
              style={{ background: name.trim() && url.trim() ? 'var(--color-green)' : 'var(--color-border)', color: name.trim() && url.trim() ? '#000' : 'var(--color-dim)', cursor: name.trim() && url.trim() ? 'pointer' : 'default' }}>
              {creating ? '…' : 'crea'}
            </button>
          </div>
        </div>
      )}

      {loading && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span></div>}
      {!loading && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          {webhooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="text-4xl">🪝</span>
              <p className="text-[12px] font-semibold text-[var(--color-muted)]">Nessun webhook</p>
              <p className="text-[10px] text-[var(--color-dim)]">Registra webhook per ricevere notifiche sugli eventi.</p>
            </div>
          ) : webhooks.map((wh, i) => (
            <div key={wh.id} className={`flex items-start gap-3 px-5 py-4 ${i < webhooks.length - 1 ? 'border-b' : ''}`} style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[12px] font-semibold text-[var(--color-bright)]">{wh.name}</span>
                  <span className="badge text-[9px]" style={{ color: wh.enabled ? 'var(--color-green)' : 'var(--color-dim)', border: `1px solid ${wh.enabled ? 'rgba(0,232,122,0.3)' : 'var(--color-border)'}`, background: wh.enabled ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
                    {wh.enabled ? 'attivo' : 'disattivo'}
                  </span>
                  <StatusPill status={pingResult[wh.id]?.status ?? wh.lastStatus} />
                </div>
                <p className="text-[10px] font-mono text-[var(--color-dim)] truncate mb-1">{wh.url}</p>
                <div className="flex flex-wrap gap-1">
                  {wh.events.map(ev => <span key={ev} className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>{ev}</span>)}
                  {wh.events.length === 0 && <span className="text-[9px] text-[var(--color-border)]">nessun evento</span>}
                </div>
                <p className="text-[9px] text-[var(--color-dim)] mt-1">ultimo trigger: {fmtDate(wh.lastTriggeredAt)}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0 mt-0.5">
                <button onClick={() => ping(wh.id)} disabled={pinging === wh.id} className="px-2 py-1 rounded text-[9px] cursor-pointer" style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}>
                  {pinging === wh.id ? '…' : 'ping'}
                </button>
                <button onClick={() => toggle(wh)} className="px-2 py-1 rounded text-[9px] cursor-pointer" style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}>
                  {wh.enabled ? 'off' : 'on'}
                </button>
                <button onClick={() => del(wh.id)} aria-label="Elimina webhook" className="px-2 py-1 rounded text-[9px] cursor-pointer" style={{ border: '1px solid rgba(255,69,96,0.2)', color: 'var(--color-red)', background: 'transparent' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
