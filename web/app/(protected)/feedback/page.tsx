'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Feedback = { id: string; rating: number; category: string; description: string; status: 'open' | 'in-progress' | 'resolved'; createdAt: number }
type Summary = { total: number; open: number; inProgress: number; resolved: number }

const CAT_CFG: Record<string, { label: string; color: string }> = {
  bug: { label: 'Bug', color: 'var(--color-red)' },
  feature: { label: 'Feature', color: 'var(--color-green)' },
  ux: { label: 'UX', color: '#61affe' },
  other: { label: 'Altro', color: 'var(--color-dim)' },
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  open: { label: 'Aperto', color: '#fca130' },
  'in-progress': { label: 'In corso', color: '#61affe' },
  resolved: { label: 'Risolto', color: 'var(--color-green)' },
}

function Stars({ rating, onChange }: { rating: number; onChange?: (n: number) => void }) {
  return (
    <span className="flex gap-0.5" role={onChange ? 'radiogroup' : undefined} aria-label={onChange ? 'Valutazione' : undefined}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} role={onChange ? 'radio' : undefined} tabIndex={onChange ? 0 : undefined} aria-checked={onChange ? n === rating : undefined} aria-label={onChange ? `${n} ${n === 1 ? 'stella' : 'stelle'}` : undefined}
          onClick={() => onChange?.(n)} onKeyDown={onChange ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(n); } } : undefined}
          className={onChange ? 'cursor-pointer' : ''} style={{ color: n <= rating ? '#fca130' : 'var(--color-border)', fontSize: onChange ? 16 : 11 }}>★</span>
      ))}
    </span>
  )
}

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

export default function FeedbackPage() {
  const [items, setItems] = useState<Feedback[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, open: 0, inProgress: 0, resolved: 0 })
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [submitMsg, setSubmitMsg] = useState<string | null>(null)
  const [form, setForm] = useState({ rating: 0, category: 'other', description: '', screenshot: '' })

  const fetchData = useCallback(async () => {
    setErrorMsg(null)
    const res = await fetch('/api/feedback', { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) {
      setItems([])
      setSummary({ total: 0, open: 0, inProgress: 0, resolved: 0 })
      setErrorMsg('Ticketing non disponibile al momento. Riprova tra poco.')
      setLoading(false)
      return
    }
    const d = await res.json()
    setItems(d.feedback ?? [])
    setSummary(d.summary ?? { total: 0, open: 0, inProgress: 0, resolved: 0 })
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const submit = async () => {
    if (!form.description.trim() || !form.rating) return
    setSubmitting(true)
    setSubmitMsg(null)

    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).catch(() => null)

    if (!res?.ok) {
      const data = await res?.json().catch(() => null)
      setSubmitMsg(data?.error ?? 'Invio non riuscito.')
      setSubmitting(false)
      return
    }

    setForm({ rating: 0, category: 'other', description: '', screenshot: '' })
    setAdding(false)
    setSubmitting(false)
    setSubmitMsg('Feedback inviato.')
    fetchData()
  }

  const inputStyle = { background: 'var(--color-deep)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' } as const

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Feedback</span>
        </nav>
        <div className="flex items-center justify-between mt-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Feedback</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{summary.open} aperti · {summary.inProgress} in corso · {summary.resolved} risolti</p>
          </div>
          <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>{adding ? 'Annulla' : '+ Nuovo'}</button>
        </div>
      </div>

      {errorMsg && (
        <div className="mb-4 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(255,82,82,0.08)', border: '1px solid rgba(255,82,82,0.35)', color: 'var(--color-red)' }}>
          {errorMsg}
        </div>
      )}

      {submitMsg && (
        <div className="mb-4 px-3 py-2 rounded-lg text-[11px]" style={{ background: submitMsg === 'Feedback inviato.' ? 'rgba(0,232,122,0.08)' : 'rgba(255,82,82,0.08)', border: submitMsg === 'Feedback inviato.' ? '1px solid rgba(0,232,122,0.35)' : '1px solid rgba(255,82,82,0.35)', color: submitMsg === 'Feedback inviato.' ? 'var(--color-green)' : 'var(--color-red)' }}>
          {submitMsg}
        </div>
      )}

      {adding && (
        <div className="mb-4 p-4 rounded-lg" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-4 mb-3">
            <div><label className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">RATING</label><div className="mt-1"><Stars rating={form.rating} onChange={n => setForm({ ...form, rating: n })} /></div></div>
            <div className="flex-1"><label htmlFor="feedback-cat" className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">CATEGORIA</label>
              <select id="feedback-cat" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} aria-label="Categoria feedback" className="w-full text-[10px] px-2 py-1.5 rounded mt-1" style={inputStyle}>
                <option value="bug">Bug</option><option value="feature">Feature</option><option value="ux">UX</option><option value="other">Altro</option>
              </select></div>
          </div>
          <div className="mb-3"><label htmlFor="feedback-desc" className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">DESCRIZIONE</label>
            <textarea id="feedback-desc" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className="w-full text-[10px] px-3 py-2 rounded-lg mt-1 resize-none" style={inputStyle} placeholder="Descrivi il tuo feedback..." /></div>
          <div className="mb-3"><label htmlFor="feedback-shot" className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">SCREENSHOT URL</label>
            <input id="feedback-shot" value={form.screenshot} onChange={e => setForm({ ...form, screenshot: e.target.value })} className="w-full text-[10px] px-3 py-2 rounded-lg mt-1" style={inputStyle} placeholder="https://..." /></div>
          <button onClick={submit} disabled={!form.description.trim() || !form.rating || submitting} className="px-4 py-1.5 rounded text-[10px] font-bold"
            style={{ background: form.description.trim() && form.rating ? 'var(--color-green)' : 'var(--color-border)', color: form.description.trim() && form.rating ? '#000' : 'var(--color-dim)', cursor: form.description.trim() && form.rating ? 'pointer' : 'default' }}>Invia feedback</button>
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {loading
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Caricamento ticket…</p></div>
          : items.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun feedback inviato.</p></div>
          : items.map(fb => {
            const cat = CAT_CFG[fb.category] ?? CAT_CFG.other
            const stat = STATUS_CFG[fb.status] ?? STATUS_CFG.open
            return (
              <div key={fb.id} className="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
                <Stars rating={fb.rating} />
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: cat.color, color: '#000' }}>{cat.label}</span>
                <p className="flex-1 text-[10px] text-[var(--color-muted)] truncate">{fb.description}</p>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ color: stat.color, border: `1px solid ${stat.color}` }}>{stat.label}</span>
                <span className="text-[8px] text-[var(--color-dim)] w-12 text-right">{timeAgo(fb.createdAt)}</span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
