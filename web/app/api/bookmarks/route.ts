import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

const STORE_DIR = path.join(os.homedir(), '.jht')
const STORE_PATH = path.join(STORE_DIR, 'bookmarks.json')

interface Bookmark {
  id: string
  jobTitle: string
  company: string
  url?: string
  note?: string
  tags: string[]
  savedAt: number
}

interface BookmarkStore { version: 1; bookmarks: Bookmark[] }

const SAMPLE: Bookmark[] = (() => {
  const now = Date.now(), DAY = 86_400_000
  return [
    { id: 'b1', jobTitle: 'Frontend Developer', company: 'Acme Corp', url: 'https://example.com/j/1', note: 'Stack interessante, React + Next.js', tags: ['frontend', 'remoto'], savedAt: now - 2_000_000 },
    { id: 'b2', jobTitle: 'Senior React Engineer', company: 'TechFlow', note: 'Contattare HR lunedì', tags: ['frontend', 'senior'], savedAt: now - DAY },
    { id: 'b3', jobTitle: 'Full Stack Developer', company: 'DataWise S.r.l.', url: 'https://example.com/j/3', note: 'Ottimo RAL, ibrido Milano', tags: ['fullstack', 'ibrido'], savedAt: now - 2 * DAY },
    { id: 'b4', jobTitle: 'Backend Engineer', company: 'CloudBase', tags: ['backend', 'remoto'], savedAt: now - 3 * DAY },
    { id: 'b5', jobTitle: 'DevOps Engineer', company: 'NetPrime', note: 'Richiede certificazione AWS', tags: ['devops'], savedAt: now - 3 * DAY - 5_000_000 },
    { id: 'b6', jobTitle: 'React Native Developer', company: 'AIStart', url: 'https://example.com/j/6', tags: ['mobile', 'startup'], savedAt: now - 4 * DAY },
    { id: 'b7', jobTitle: 'Tech Lead', company: 'CodeLab S.p.A.', note: 'Posizione leadership, team 8 persone', tags: ['senior', 'leadership'], savedAt: now - 5 * DAY },
    { id: 'b8', jobTitle: 'Python Developer', company: 'DataScience Hub', tags: ['backend', 'ml'], savedAt: now - 6 * DAY },
  ]
})()

function load(): BookmarkStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    const data = JSON.parse(raw) as BookmarkStore
    return Array.isArray(data?.bookmarks) ? data : { version: 1, bookmarks: [] }
  } catch { return { version: 1, bookmarks: [] } }
}

function save(store: BookmarkStore) {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  const tmp = STORE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  fs.renameSync(tmp, STORE_PATH)
}

/** GET — lista bookmarks: ?tag=frontend&sort=company|date */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const tag = sp.get('tag')
  const sort = sp.get('sort') ?? 'date'
  const q = sp.get('q')?.toLowerCase()

  const store = load()
  let items = store.bookmarks
  if (tag) items = items.filter(b => b.tags.includes(tag))
  if (q) items = items.filter(b => b.jobTitle.toLowerCase().includes(q) || b.company.toLowerCase().includes(q))

  if (sort === 'company') items.sort((a, b) => a.company.localeCompare(b.company))
  else items.sort((a, b) => b.savedAt - a.savedAt)

  const allTags = [...new Set(store.bookmarks.flatMap(b => b.tags))].sort()
  return NextResponse.json({ bookmarks: items, total: items.length, allTags })
}

/** POST — aggiungi bookmark */
export async function POST(req: NextRequest) {
  let body: Partial<Bookmark> = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.jobTitle?.trim() || !body.company?.trim()) {
    return NextResponse.json({ ok: false, error: 'jobTitle e company obbligatori' }, { status: 400 })
  }
  const bookmark: Bookmark = {
    id: randomUUID(), jobTitle: body.jobTitle.trim(), company: body.company.trim(),
    url: body.url?.trim() || undefined, note: body.note?.trim() || undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(t => t.trim()).filter(Boolean) : [],
    savedAt: Date.now(),
  }
  const store = load()
  store.bookmarks.push(bookmark)
  save(store)
  return NextResponse.json({ ok: true, bookmark }, { status: 201 })
}

/** DELETE — rimuovi bookmark: ?id=xxx oppure ?all=true */
export async function DELETE(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all')
  const id = req.nextUrl.searchParams.get('id')
  const store = load()
  if (all === 'true') {
    const count = store.bookmarks.length
    store.bookmarks = []
    save(store)
    return NextResponse.json({ ok: true, deleted: count })
  }
  if (!id) return NextResponse.json({ ok: false, error: 'id o all obbligatorio' }, { status: 400 })
  const idx = store.bookmarks.findIndex(b => b.id === id)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'bookmark non trovato' }, { status: 404 })
  store.bookmarks.splice(idx, 1)
  save(store)
  return NextResponse.json({ ok: true })
}
