/**
 * Rate limiter applicativo condiviso.
 *
 * Il middleware applica gia' un cap globale per IP, ma i singoli
 * endpoint hanno bisogno di difese piu' strette e su chiavi diverse:
 * il tokenId per i cloud-sync (i client dietro NAT condividono l'IP,
 * e un token compromesso non deve martellare il backend), l'IP per i
 * canali pubblici come /api/feedback.
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

const STORE = new Map<string, { count: number; windowStart: number }>();
const CLEANUP_AT_MOST_EVERY_MS = 5 * 60_000;
let lastCleanup = Date.now();

function cleanupExpired(now: number, windowMs: number): void {
  if (now - lastCleanup < CLEANUP_AT_MOST_EVERY_MS) return;
  lastCleanup = now;
  for (const [key, entry] of STORE) {
    if (now - entry.windowStart > windowMs) STORE.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  retryAfterSec: number;
}

function inMemoryCheck(
  bucketKey: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  cleanupExpired(now, windowMs);

  const entry = STORE.get(bucketKey);
  if (!entry || now - entry.windowStart > windowMs) {
    STORE.set(bucketKey, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: max - 1,
      resetAtMs: now + windowMs,
      retryAfterSec: 0,
    };
  }

  entry.count++;
  const remaining = Math.max(0, max - entry.count);
  const resetAtMs = entry.windowStart + windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
  return {
    allowed: entry.count <= max,
    remaining,
    resetAtMs,
    retryAfterSec,
  };
}

async function upstashCheck(
  bucketKey: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  // INCR + EXPIRE atomici via Upstash pipeline REST. Se la prima call
  // restituisce 1, settiamo la finestra; altrimenti leggiamo PTTL.
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", bucketKey],
        ["EXPIRE", bucketKey, windowSec, "NX"],
        ["PTTL", bucketKey],
      ]),
    });
    if (!res.ok) return null;
    const payload: unknown = await res.json();
    if (!Array.isArray(payload) || payload.length < 3) return null;
    const count = Number((payload[0] as { result?: unknown })?.result);
    const pttl = Number((payload[2] as { result?: unknown })?.result);
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      !Number.isFinite(pttl) ||
      pttl <= 0
    )
      return null;
    const now = Date.now();
    const resetAtMs = now + (pttl > 0 ? pttl : windowMs);
    const remaining = Math.max(0, max - count);
    return {
      allowed: count <= max,
      remaining,
      resetAtMs,
      retryAfterSec: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  } catch {
    return null;
  }
}

/**
 * Rate limit that never degrades to process-local memory.
 *
 * Use this before privileged best-effort work exposed to anonymous traffic:
 * without distributed coordination, skipping that work is safer than giving
 * every instance and cold start a fresh budget.
 */
export async function checkDistributedRateLimit(
  namespace: string,
  scope: string,
  identity: string,
  max: number,
  windowMs: number = 60_000,
): Promise<RateLimitResult | null> {
  return upstashCheck(`${namespace}:${scope}:${identity}`, max, windowMs);
}

/**
 * Verifica il rate limit di un endpoint.
 *
 * @param namespace famiglia di endpoint (es. `'cloud-sync'`, `'feedback'`)
 * @param scope etichetta dell'endpoint (es. `'push'`, `'ping'`, `'tokens'`)
 * @param identity la chiave su cui contiamo — tokenId, userId o IP
 * @param max massime richieste nella finestra
 * @param windowMs lunghezza finestra in ms (default 60_000)
 */
export async function checkRateLimit(
  namespace: string,
  scope: string,
  identity: string,
  max: number,
  windowMs: number = 60_000,
): Promise<RateLimitResult> {
  const bucketKey = `${namespace}:${scope}:${identity}`;
  const upstash = await checkDistributedRateLimit(
    namespace,
    scope,
    identity,
    max,
    windowMs,
  );
  if (upstash) return upstash;
  return inMemoryCheck(bucketKey, max, windowMs);
}
