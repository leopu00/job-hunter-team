/**
 * CSRF guard per richieste mutanti.
 *
 * Pattern: OpenClaw `browserMutationGuardMiddleware`
 * (extensions/browser/src/browser/csrf.ts).
 *
 * Su richieste GET/HEAD/OPTIONS lasciamo passare (lo Same-Origin
 * Policy + auth bastano: niente effetto collaterale).
 *
 * Sui metodi mutanti (POST/PUT/PATCH/DELETE) controlliamo, in
 * ordine:
 *   1. `Sec-Fetch-Site === 'cross-site'` → reject (segnale forte
 *      del browser).
 *   2. Header `Origin` o `Referer` presente e combacia con
 *      `hostOrigin` (l'origin del server stesso, dedotto dai
 *      forwarded headers) → pass. Questa è la definizione canonica
 *      di same-origin: il browser dichiara che la richiesta parte
 *      dal nostro stesso dominio.
 *   3. Header `Origin` presente: deve essere in allowlist statica.
 *   4. Header `Referer` presente (e Origin assente): host estratto
 *      deve essere in allowlist statica.
 *   5. Niente Origin né Referer → pass (CLI / curl / Node script).
 *
 * Allowlist statica (fallback quando hostOrigin non disponibile,
 * tipicamente dev locale):
 *   - `http://localhost:{3000,3001,3002}` (dev locale)
 *   - `http://127.0.0.1:{3000,3001,3002}` (loopback IP-form)
 *   - origin pubblico cloud-sync, se settato in `JHT_PUBLIC_ORIGIN`
 *     (es. `https://jobhunter.team`).
 */

const STATIC_ALLOWED = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
])

function isMutatingMethod(method: string): boolean {
  const m = method.trim().toUpperCase()
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'
}

function publicOrigin(): string | null {
  const value = process.env.JHT_PUBLIC_ORIGIN?.trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

export function isAllowedOrigin(value: string | null | undefined): boolean {
  const v = (value ?? '').trim()
  if (!v || v === 'null') return false
  if (STATIC_ALLOWED.has(v)) return true
  const prod = publicOrigin()
  return prod !== null && v === prod
}

function originFromReferer(referer: string): string | null {
  try {
    const url = new URL(referer)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export interface MutationCheck {
  method: string
  origin?: string | null
  referer?: string | null
  secFetchSite?: string | null
  /**
   * Origin del server (es. `https://jobhunterteam.ai`), tipicamente
   * ricavato dai forwarded headers nel proxy. Quando l'Origin/Referer
   * della richiesta combaciano con questo, la richiesta è same-origin
   * per definizione e va lasciata passare anche se il dominio prod non
   * è in `STATIC_ALLOWED`/`JHT_PUBLIC_ORIGIN`.
   */
  hostOrigin?: string | null
}

/**
 * Ritorna `true` se la richiesta deve essere rifiutata (403).
 * Esposta separatamente per i test unit.
 */
export function shouldRejectBrowserMutation(params: MutationCheck): boolean {
  if (!isMutatingMethod(params.method)) return false

  const sfs = (params.secFetchSite ?? '').trim().toLowerCase()
  if (sfs === 'cross-site') return true

  const hostOrigin = (params.hostOrigin ?? '').trim()
  const origin = (params.origin ?? '').trim()
  if (origin) {
    if (hostOrigin && origin === hostOrigin) return false
    return !isAllowedOrigin(origin)
  }

  const referer = (params.referer ?? '').trim()
  if (referer) {
    const ref = originFromReferer(referer)
    if (ref === null) return true
    if (hostOrigin && ref === hostOrigin) return false
    return !isAllowedOrigin(ref)
  }

  // Niente Origin né Referer: client non-browser. Pass-through.
  return false
}
