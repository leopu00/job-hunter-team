/**
 * Client minimale per Hetzner Cloud API.
 *
 * Scope: solo le operazioni di lifecycle che servono ai 3 bottoni
 * dashboard (`docs/internal/vps.md` § "Companycycle e shutdown UX"):
 *
 *   - listServers / findServerByIp  → resolve dell'ID a partire dall'IP
 *   - createSnapshot                → snapshot pre-destroy ("📸 Snapshot")
 *   - deleteServer                  → ferma la fattura ("💀 Termina")
 *
 * NIENTE create-server qui: decisione lockata 2026-05-13 #1 — la
 * desktop app NON automatizza la creazione VPS via Hetzner API per
 * limitare il blast radius. Il token Hetzner viene letto solo per
 * destroy/snapshot, cioe' azioni che operano su un server CHE GIA'
 * ESISTE e che l'utente ha gia' deciso di eliminare.
 *
 * Token: `process.env.HCLOUD_TOKEN` (convenzione `hcloud` CLI) o, in
 * fallback, `JHT_HETZNER_API_TOKEN`. Se nessuno e' settato le funzioni
 * ritornano `null` e il chiamante (route handler) risponde 503: la UI
 * fa fallback a "Apri portale Hetzner manualmente".
 */

const HCLOUD_BASE = 'https://api.hetzner.cloud/v1'

export type HetznerServer = {
  id: number
  name: string
  status: string
  public_net?: {
    ipv4?: { ip: string } | null
    ipv6?: { ip: string } | null
  }
}

export type HetznerImage = {
  id: number
  type: string
  status: string
  description: string | null
}

export type HetznerAction = {
  id: number
  status: 'running' | 'success' | 'error'
  error?: { code: string; message: string } | null
}

export function getHetznerToken(): string | null {
  const t = (process.env.HCLOUD_TOKEN || process.env.JHT_HETZNER_API_TOKEN || '').trim()
  return t || null
}

/**
 * Risolve l'ID del server Hetzner da operare. Due strade:
 *
 *  1. `JHT_VPS_SERVER_ID` esplicito → fast path. Settato dal desktop
 *     launcher al momento del provisioning oppure dall'utente in
 *     `~/.jht/host.env` per il path tech (SSH manuale).
 *  2. Fallback: `JHT_VPS_IP` + lookup `findServerByIp`. Pensato per
 *     l'install tech in cui l'utente ha solo l'IP (creato il server
 *     da portale Hetzner senza che l'app sappia l'ID interno).
 *
 * Restituisce numero (id) o { error, status } pronto da rispondere.
 */
export async function resolveServerId(
  token: string
): Promise<{ ok: true; id: number } | { ok: false; status: number; error: string }> {
  const explicit = (process.env.JHT_VPS_SERVER_ID || '').trim()
  if (explicit) {
    const n = Number(explicit)
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, status: 500, error: `JHT_VPS_SERVER_ID non numerico: ${explicit}` }
    }
    return { ok: true, id: n }
  }
  const ip = (process.env.JHT_VPS_IP || '').trim()
  if (!ip) {
    return {
      ok: false,
      status: 500,
      error: 'JHT_VPS_SERVER_ID e JHT_VPS_IP non settati: impossibile sapere quale server gestire',
    }
  }
  const r = await findServerByIp(token, ip)
  if (!r.ok) return r
  return { ok: true, id: r.data.id }
}

async function hcloud<T>(
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${HCLOUD_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Hetzner API risponde in genere < 1s, alziamo la guardia a 30s
      // per il poll di azioni asincrone (snapshot puo' impiegare minuti
      // — ma chiamiamo poll separati, non un singolo request lungo).
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message }
  }

  // 204 No Content (es. DELETE riuscito): ritorna oggetto vuoto.
  if (res.status === 204) return { ok: true, data: {} as T }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, status: res.status, error: `HTTP ${res.status} (no JSON body)` }
  }

  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } })?.error
    return {
      ok: false,
      status: res.status,
      error: err?.message || `HTTP ${res.status}`,
    }
  }
  return { ok: true, data: json as T }
}

/** Lista tutti i server del progetto. Paginato a 50 di default Hetzner. */
export async function listServers(token: string) {
  return hcloud<{ servers: HetznerServer[] }>(token, 'GET', '/servers?per_page=50')
}

/**
 * Trova il primo server il cui IPv4 pubblico matcha `ip`. Usato per
 * risolvere l'ID del server quando l'env `JHT_VPS_SERVER_ID` non e'
 * configurato (caso comune sul beta: il server e' stato creato dal
 * portale Hetzner manualmente, l'app non sa il suo ID).
 */
export async function findServerByIp(token: string, ip: string) {
  const r = await listServers(token)
  if (!r.ok) return r
  const match = r.data.servers.find((s) => s.public_net?.ipv4?.ip === ip)
  if (!match) {
    return { ok: false as const, status: 404, error: `Nessun server Hetzner con IP ${ip}` }
  }
  return { ok: true as const, data: match }
}

/**
 * Crea uno snapshot del server. Hetzner ritorna un'action asincrona:
 * il chiamante deve poi pollare `getAction(id)` finche' lo status
 * passa a `success` (di solito 30s-2min). Per il bottone "Snapshot +
 * Termina" attendiamo lo snapshot success PRIMA di chiamare delete.
 */
export async function createSnapshot(token: string, serverId: number, description: string) {
  return hcloud<{ action: HetznerAction; image: HetznerImage }>(
    token,
    'POST',
    `/servers/${serverId}/actions/create_image`,
    { type: 'snapshot', description }
  )
}

/** Poll di una action Hetzner (snapshot, delete, ...). */
export async function getAction(token: string, actionId: number) {
  return hcloud<{ action: HetznerAction }>(token, 'GET', `/actions/${actionId}`)
}

/**
 * Attendi che un'action raggiunga `success` o `error`. Timeout 5min
 * (snapshot di un disco da 80GB non dovrebbe superare i 3-4 min su
 * Hetzner). Restituisce l'ultimo stato osservato.
 */
export async function waitAction(token: string, actionId: number, timeoutMs = 5 * 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = await getAction(token, actionId)
    if (!r.ok) return r
    const status = r.data.action.status
    if (status === 'success' || status === 'error') return r
    await new Promise((res) => setTimeout(res, 4_000))
  }
  return {
    ok: false as const,
    status: 504,
    error: `Action ${actionId} non completata entro ${timeoutMs}ms`,
  }
}

/**
 * Distrugge il server. Hetzner ritorna sempre un'action; il delete
 * vero arriva quando l'action passa success (di solito < 10s). Per
 * il bottone "Termina" non aspettiamo: rispondiamo subito e l'utente
 * vede la sparizione del server dal portale Hetzner pochi secondi
 * dopo. Il server smette di fatturare dal momento del delete.
 */
export async function deleteServer(token: string, serverId: number) {
  return hcloud<{ action: HetznerAction }>(token, 'DELETE', `/servers/${serverId}`)
}
