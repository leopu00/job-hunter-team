/**
 * Rate limiter dedicato per gli endpoint /api/cloud-sync/*.
 *
 * Il middleware proxy.ts applica gia' un cap globale di 120 req/min
 * per IP, ma sui cloud-sync vogliamo una difesa piu' stretta basata
 * su `tokenId` (o `userId` per /tokens), non su IP — i client di sync
 * possono condividere NAT, e un singolo token compromesso non deve
 * martellare il backend.
 *
 * Storage: in-memory token-bucket fixed-window. Funziona finche' ogni
 * istanza Vercel function gira sullo stesso warm container. In multi-
 * region o con cold-start il counter si resetta — accettabile per il
 * volume attuale di JHT (singoli utenti, sync periodici).
 *
 * Quando il volume cresce: settare UPSTASH_REDIS_REST_URL +
 * UPSTASH_REDIS_REST_TOKEN e abilitare la branch Upstash sotto. Niente
 * SDK nuovi: il REST API si chiama via fetch.
 */

const STORE = new Map<string, { count: number; windowStart: number }>()
const CLEANUP_AT_MOST_EVERY_MS = 5 * 60_000
let lastCleanup = Date.now()

function cleanupExpired(now: number, windowMs: number): void {
  if (now - lastCleanup < CLEANUP_AT_MOST_EVERY_MS) return
  lastCleanup = now
  for (const [key, entry] of STORE) {
    if (now - entry.windowStart > windowMs) STORE.delete(key)
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAtMs: number
  retryAfterSec: number
}

function inMemoryCheck(
  bucketKey: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  cleanupExpired(now, windowMs)

  const entry = STORE.get(bucketKey)
  if (!entry || now - entry.windowStart > windowMs) {
    STORE.set(bucketKey, { count: 1, windowStart: now })
    return { allowed: true, remaining: max - 1, resetAtMs: now + windowMs, retryAfterSec: 0 }
  }

  entry.count++
  const remaining = Math.max(0, max - entry.count)
  const resetAtMs = entry.windowStart + windowMs
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - now) / 1000))
  return {
    allowed: entry.count <= max,
    remaining,
    resetAtMs,
    retryAfterSec,
  }
}

async function upstashCheck(
  bucketKey: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null

  // INCR + EXPIRE atomici via Upstash pipeline REST. Se la prima call
  // restituisce 1, settiamo la finestra; altrimenti leggiamo PTTL.
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000))
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', bucketKey],
        ['EXPIRE', bucketKey, windowSec, 'NX'],
        ['PTTL', bucketKey],
      ]),
    })
    if (!res.ok) return null
    const arr = (await res.json()) as Array<{ result: number | string }>
    const count = Number(arr[0]?.result ?? 0)
    const pttl = Number(arr[2]?.result ?? windowMs)
    const now = Date.now()
    const resetAtMs = now + (pttl > 0 ? pttl : windowMs)
    const remaining = Math.max(0, max - count)
    return {
      allowed: count <= max,
      remaining,
      resetAtMs,
      retryAfterSec: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    }
  } catch {
    return null
  }
}

/**
 * Verifica il rate limit per un endpoint cloud-sync.
 *
 * @param scope etichetta dell'endpoint (es. `'push'`, `'ping'`, `'tokens'`)
 * @param identity tokenId o userId — la chiave su cui contiamo
 * @param max massime richieste nella finestra
 * @param windowMs lunghezza finestra in ms (default 60_000)
 */
export async function checkCloudSyncRateLimit(
  scope: string,
  identity: string,
  max: number,
  windowMs: number = 60_000,
): Promise<RateLimitResult> {
  const bucketKey = `cloud-sync:${scope}:${identity}`
  const upstash = await upstashCheck(bucketKey, max, windowMs)
  if (upstash) return upstash
  return inMemoryCheck(bucketKey, max, windowMs)
}
