import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import { requireAuth } from '@/lib/auth'
import { JHT_CONFIG_PATH } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

// Provider switch rapido per dev mode: aggiorna SOLO active_provider in
// ~/.jht/jht.config.json, lasciando tutto il resto invariato. Usato dal
// dropdown sulla pagina /team per testare kimi vs codex vs claude senza
// dover editare il file a mano. Il team va riavviato per raccogliere il
// cambio (ogni CLI gira nella sua tmux con il suo provider; il bridge
// della sentinella rilegge active_provider ad ogni tick).
const ALLOWED = ['anthropic', 'openai', 'kimi', 'moonshot', 'minimax'] as const

type Provider = typeof ALLOWED[number]

export async function POST(req: NextRequest) {
  const authError = await requireAuth()
  if (authError) return authError

  let body: { provider?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'body non valido' }, { status: 400 }) }

  const raw = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : ''
  const normalized: Provider | null = (ALLOWED as readonly string[]).includes(raw) ? raw as Provider : null
  if (!normalized) {
    return NextResponse.json({ ok: false, error: `provider deve essere uno di: ${ALLOWED.join(', ')}` }, { status: 400 })
  }

  let cfg: Record<string, unknown> = {}
  try {
    const content = await fs.readFile(JHT_CONFIG_PATH, 'utf8')
    cfg = JSON.parse(content)
  } catch {
    // File mancante o JSON rotto: partiamo da zero con struttura minima
    cfg = { providers: {} }
  }

  cfg.active_provider = normalized
  // Se non c'e' ancora un provider config per il nuovo attivo, inserisci
  // uno stub con subscription (il default: usa il CLI gia' loggato). Se
  // l'utente usa api_key dovra' configurarla dalla pagina setup.
  const providers = (cfg.providers ?? {}) as Record<string, Record<string, unknown>>
  if (!providers[normalized]) {
    providers[normalized] = { auth_method: 'subscription' }
  }
  cfg.providers = providers

  try {
    await fs.writeFile(JHT_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'errore scrittura' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, provider: normalized })
}
