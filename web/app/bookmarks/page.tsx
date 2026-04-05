'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useMemo } from 'react'

type Bookmark = { id: string; jobTitle: string; company: string; url?: string; note?: string; tags: string[]; savedAt: number }
type SortMode = 'date' | 'company'

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [filterTag, setFilterTag] = useState('all')
  const [sort, setSort] = useState<SortMode>('date')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')

  const fetchData = useCallback(async () => {
    const p = new URLSearchParams(); p.set('sort', sort)
    if (filterTag !== 'all') p.set('tag', filterTag)
    if (search.trim()) p.set('q', search.trim())
    const res = await fetch(`/api/bookmarks?${p}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setBookmarks(data.bookmarks ?? []); setAllTags(data.allTags ?? [])
  }, [filterTag, sort, search])

  useEffect(() => { fetchData() }, [fetchData])

  const addBookmark = async () => {
    if (!title.trim() || !company.trim()) return
    await fetch('/api/bookmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobTitle: title.trim(), company: company.trim(), url: url.trim() || undefined,
        note: note.trim() || undefined, tags: tags.split(',').map(t => t.trim()).filter(Boolean) }) })
    setTitle(''); setCompany(''); setUrl(''); setNote(''); setTags(''); setShowForm(false); fetchData()
  }

  const remove = async (id: string) => { await fetch(`/api/bookmarks?id=${id}`, { method: 'DELETE' }); fetchData() }

  const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Segnalibri</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Segnalibri</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">{bookmarks.length} job salvati</p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="px-3 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer"
            style={{ background: showForm ? 'transparent' : 'var(--color-green)', color: showForm ? 'var(--color-muted)' : '#000', border: showForm ? '1px solid var(--color-border)' : 'none' }}>
            {showForm ? 'annulla' : '+ aggiungi'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Nuovo segnalibro</p>
          <div className="flex flex-wrap gap-2 items-end">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Titolo posizione *"
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)] flex-1 min-w-[140px]" />
            <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Azienda *"
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)] min-w-[120px]" />
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="URL (opzionale)"
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)] min-w-[120px]" />
          </div>
          <div className="flex flex-wrap gap-2 items-end mt-2">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note personali"
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)] flex-1 min-w-[200px]" />
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tag (virgola-separati)"
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)] min-w-[140px]" />
            <button onClick={addBookmark} className="px-4 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
              style={{ background: 'var(--color-green)', color: '#000', border: 'none' }}>salva</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca titolo o azienda..."
          aria-label="Cerca preferiti" className="text-[11px] px-3 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)] w-48" />
        <div className="flex gap-1">
          {['all', ...allTags].map(t => (
            <button key={t} onClick={() => setFilterTag(t)}
              className="px-2.5 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
              style={{ background: filterTag === t ? 'var(--color-row)' : 'transparent', color: filterTag === t ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filterTag === t ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {t === 'all' ? 'tutti' : t}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {([['date', 'data'], ['company', 'azienda']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setSort(v)}
              className="px-2.5 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
              style={{ background: sort === v ? 'var(--color-row)' : 'transparent', color: sort === v ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${sort === v ? 'var(--color-border-glow)' : 'transparent'}` }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {bookmarks.length === 0 ? (
          <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun segnalibro trovato.</p></div>
        ) : bookmarks.map(b => (
          <div key={b.id} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
            <span className="text-sm flex-shrink-0">⭐</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-[var(--color-bright)] hover:underline">{b.jobTitle}</a>
                  : <span className="text-[12px] font-semibold text-[var(--color-bright)]">{b.jobTitle}</span>}
                <span className="text-[10px] text-[var(--color-muted)]">@ {b.company}</span>
              </div>
              {b.note && <p className="text-[10px] text-[var(--color-dim)] truncate mt-0.5">{b.note}</p>}
              {b.tags.length > 0 && (
                <div className="flex gap-1 mt-1">{b.tags.map(t => (
                  <span key={t} className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>{t}</span>
                ))}</div>
              )}
            </div>
            <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0">{fmtDate(b.savedAt)}</span>
            <button onClick={() => remove(b.id)} className="text-[10px] font-bold cursor-pointer transition-colors flex-shrink-0"
              style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-red)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}
