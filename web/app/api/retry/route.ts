import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const STATE_PATH = path.join(JHT_HOME, 'retry', 'circuit-breakers.json')

type CircuitState = 'closed' | 'open' | 'half-open'

type BreakerRecord = {
  id: string; label: string; state: CircuitState
  failures: number; successes: number
  failureThreshold: number; resetTimeoutMs: number; halfOpenSuccesses: number
  lastFailureAt?: number; lastSuccessAt?: number; openedAt?: number
  totalFailures: number; totalSuccesses: number; totalOpened: number
}

type BreakerStore = { version: 1; updatedAt: number; breakers: BreakerRecord[] }

function loadStore(): BreakerStore {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
    return Array.isArray(raw?.breakers) ? raw : { version: 1, updatedAt: Date.now(), breakers: [] }
  } catch { return { version: 1, updatedAt: Date.now(), breakers: [] } }
}

function saveStore(store: BreakerStore) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

function resolveState(b: BreakerRecord): CircuitState {
  if (b.state === 'open' && b.openedAt) {
    const elapsed = Date.now() - b.openedAt
    if (elapsed >= b.resetTimeoutMs) return 'half-open'
  }
  return b.state
}

/** GET — stato di tutti i circuit breaker, opzionale ?id=xxx per singolo */
export async function GET(req: NextRequest) {
  const store = loadStore()
  const single = req.nextUrl.searchParams.get('id')

  const breakers = store.breakers.map(b => ({ ...b, state: resolveState(b) }))

  if (single) {
    const found = breakers.find(b => b.id === single)
    if (!found) return NextResponse.json({ ok: false, error: 'Breaker non trovato' }, { status: 404 })
    return NextResponse.json(found)
  }

  const summary = {
    total: breakers.length,
    closed: breakers.filter(b => b.state === 'closed').length,
    open: breakers.filter(b => b.state === 'open').length,
    halfOpen: breakers.filter(b => b.state === 'half-open').length,
    totalFailures: breakers.reduce((s, b) => s + b.totalFailures, 0),
  }
  return NextResponse.json({ breakers, summary, updatedAt: store.updatedAt })
}

/** POST — reset di un circuit breaker: { id: string } */
export async function POST(req: NextRequest) {
  let body: { id?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.id) return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })

  const store = loadStore()
  const breaker = store.breakers.find(b => b.id === body.id)
  if (!breaker) return NextResponse.json({ ok: false, error: 'Breaker non trovato' }, { status: 404 })

  breaker.state = 'closed'
  breaker.failures = 0
  breaker.successes = 0
  breaker.openedAt = undefined
  store.updatedAt = Date.now()
  saveStore(store)
  return NextResponse.json({ ok: true, id: body.id, state: 'closed' })
}
