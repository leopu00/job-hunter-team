import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const STORE_DIR = JHT_HOME
const STORE_PATH = path.join(STORE_DIR, 'activity-history.json')

type ActionType = 'view' | 'apply' | 'save' | 'edit' | 'delete'
type EntityType = 'job' | 'contact' | 'company' | 'template' | 'document' | 'session'

interface Activity {
  id: string
  action: ActionType
  entity: EntityType
  entityName: string
  detail?: string
  timestamp: number
}

interface ActivityStore { version: 1; activities: Activity[] }

const SAMPLE: Activity[] = (() => {
  const now = Date.now(), DAY = 86_400_000
  return [
    { id: 'a1', action: 'apply', entity: 'job', entityName: 'Frontend Dev @ Acme', detail: 'Cover letter inviata', timestamp: now - 1_800_000 },
    { id: 'a2', action: 'view', entity: 'job', entityName: 'Senior React @ TechFlow', timestamp: now - 3_600_000 },
    { id: 'a3', action: 'edit', entity: 'document', entityName: 'CV Principale', detail: 'Aggiunta sezione progetti', timestamp: now - 5_400_000 },
    { id: 'a4', action: 'save', entity: 'job', entityName: 'Full Stack @ DataWise', detail: 'Salvata per dopo', timestamp: now - 7_200_000 },
    { id: 'a5', action: 'view', entity: 'company', entityName: 'CloudBase S.r.l.', timestamp: now - DAY - 1_000_000 },
    { id: 'a6', action: 'apply', entity: 'job', entityName: 'Backend Engineer @ DevHub', detail: 'Candidatura spontanea', timestamp: now - DAY - 3_000_000 },
    { id: 'a7', action: 'edit', entity: 'template', entityName: 'Cover Letter Standard', detail: 'Aggiornata intro', timestamp: now - DAY - 5_000_000 },
    { id: 'a8', action: 'save', entity: 'contact', entityName: 'Marco Rossi (HR TechFlow)', timestamp: now - DAY - 7_000_000 },
    { id: 'a9', action: 'delete', entity: 'session', entityName: 'Sessione 2026-04-02', detail: 'Pulizia sessioni vecchie', timestamp: now - 2 * DAY - 2_000_000 },
    { id: 'a10', action: 'view', entity: 'job', entityName: 'DevOps @ NetPrime', timestamp: now - 2 * DAY - 4_000_000 },
    { id: 'a11', action: 'apply', entity: 'job', entityName: 'React Native @ AIStart', detail: 'Via LinkedIn', timestamp: now - 3 * DAY - 1_000_000 },
    { id: 'a12', action: 'edit', entity: 'document', entityName: 'Lettera Motivazionale', timestamp: now - 3 * DAY - 6_000_000 },
    { id: 'a13', action: 'save', entity: 'company', entityName: 'CodeLab S.p.A.', detail: 'Azienda interessante', timestamp: now - 4 * DAY - 2_000_000 },
    { id: 'a14', action: 'view', entity: 'template', entityName: 'Salary Negotiation', timestamp: now - 5 * DAY - 1_000_000 },
    { id: 'a15', action: 'delete', entity: 'contact', entityName: 'Contatto duplicato', timestamp: now - 6 * DAY - 3_000_000 },
  ]
})()

function load(): ActivityStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    const data = JSON.parse(raw) as ActivityStore
    return Array.isArray(data?.activities) ? data : { version: 1, activities: [] }
  } catch { return { version: 1, activities: [] } }
}

function save(store: ActivityStore) {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  const tmp = STORE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  fs.renameSync(tmp, STORE_PATH)
}

/** GET — lista attività: ?action=apply&entity=job&days=7 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const action = sp.get('action') as ActionType | null
  const entity = sp.get('entity') as EntityType | null
  const days = parseInt(sp.get('days') ?? '30', 10) || 30
  const since = Date.now() - days * 86_400_000

  const store = load()
  let items = store.activities.filter(a => a.timestamp >= since)
  if (action) items = items.filter(a => a.action === action)
  if (entity) items = items.filter(a => a.entity === entity)
  items.sort((a, b) => b.timestamp - a.timestamp)

  return NextResponse.json({ activities: items, total: items.length, days })
}

/** POST — registra attività */
export async function POST(req: NextRequest) {
  let body: Partial<Activity> = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.action || !body.entity || !body.entityName?.trim()) {
    return NextResponse.json({ ok: false, error: 'action, entity, entityName obbligatori' }, { status: 400 })
  }
  const activity: Activity = {
    id: randomUUID(), action: body.action, entity: body.entity,
    entityName: body.entityName.trim(), detail: body.detail?.trim(), timestamp: Date.now(),
  }
  const store = load()
  store.activities.push(activity)
  save(store)
  return NextResponse.json({ ok: true, activity }, { status: 201 })
}

/** DELETE — clear history: ?all=true oppure ?id=xxx */
export async function DELETE(req: NextRequest) {
  const all = req.nextUrl.searchParams.get('all')
  const id = req.nextUrl.searchParams.get('id')
  const store = load()
  if (all === 'true') {
    const count = store.activities.length
    store.activities = []
    save(store)
    return NextResponse.json({ ok: true, deleted: count })
  }
  if (!id) return NextResponse.json({ ok: false, error: 'id o all obbligatorio' }, { status: 400 })
  const idx = store.activities.findIndex(a => a.id === id)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'non trovata' }, { status: 404 })
  store.activities.splice(idx, 1)
  save(store)
  return NextResponse.json({ ok: true })
}
