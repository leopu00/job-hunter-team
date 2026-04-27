import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { JHT_HOME } from '@/lib/jht-paths'
import { requireAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const SECRETS_PATH = path.join(JHT_HOME, 'secrets.json')

export type SecretType = 'api_key' | 'token' | 'password' | 'webhook' | 'other'

interface SecretEntry {
  id: string
  name: string
  type: SecretType
  value: string
  createdAt: number
}

interface SecretStore {
  version: number
  secrets: SecretEntry[]
}

function load(): SecretStore {
  try {
    const raw = fs.readFileSync(SECRETS_PATH, 'utf-8')
    const p = JSON.parse(raw) as SecretStore
    return p?.secrets ? p : { version: 1, secrets: [] }
  } catch (e: any) {
    if (e.code === 'ENOENT') return { version: 1, secrets: [] }
    throw e
  }
}

function save(store: SecretStore): void {
  fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true })
  const tmp = SECRETS_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, SECRETS_PATH)
}

function mask(value: string): string {
  if (value.length <= 4) return '****'
  return value.slice(0, 4) + '•'.repeat(Math.min(value.length - 4, 12))
}

/**
 * GET — lista secrets sempre mascherati. Niente parametro `?id=` reveal:
 * il valore in chiaro si ottiene solo via `POST /api/secrets/reveal`
 * (vedi finding H1: il vecchio GET esponeva enumerazione id + reveal
 * nello stesso endpoint, sufficiente a estrarre tutti i secret con due
 * GET una volta superato il check auth).
 */
export async function GET() {
  const denied = await requireAuth()
  if (denied) return denied
  const store = load()
  const secrets = store.secrets.map(s => ({
    id: s.id,
    name: s.name,
    type: s.type,
    value: mask(s.value),
    masked: true,
    createdAt: s.createdAt,
  }))
  return NextResponse.json({ secrets, total: secrets.length })
}

/** POST — crea nuovo secret */
export async function POST(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied
  let body: { name?: string; type?: SecretType; value?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  const name = body.name?.trim()
  const value = body.value?.trim()
  if (!name || !value) {
    return NextResponse.json({ ok: false, error: 'name e value obbligatori' }, { status: 400 })
  }

  const entry: SecretEntry = {
    id: randomUUID(),
    name,
    type: body.type ?? 'other',
    value,
    createdAt: Date.now(),
  }
  const store = load()
  store.secrets.push(entry)
  save(store)
  return NextResponse.json({ ok: true, id: entry.id, name: entry.name }, { status: 201 })
}

/** DELETE — rimuove secret per ID */
export async function DELETE(req: NextRequest) {
  const denied = await requireAuth()
  if (denied) return denied
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })

  const store = load()
  const idx = store.secrets.findIndex(s => s.id === id)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'secret non trovato' }, { status: 404 })

  store.secrets.splice(idx, 1)
  save(store)
  return NextResponse.json({ ok: true })
}
