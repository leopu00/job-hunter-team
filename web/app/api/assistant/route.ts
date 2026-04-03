import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

export const dynamic = 'force-dynamic'

const CAPTAIN_SESSION = 'ALFA'
const ASSISTANT_SESSION = 'ASSISTENTE'

/** Classsifica l'intent del testo in modo leggero (senza importare shared/) */
function classifyIntent(text: string): string {
  const t = text.toLowerCase().trim()
  if (/trov[ai]|cerca|lavoro|posizion|job|opportunit/.test(t)) return 'job_search'
  if (/stato|status|come va|progress|pipeline|report/.test(t)) return 'status_check'
  if (/candidatur|applicazion|list[ae]|quant/.test(t)) return 'list_applications'
  if (/ferma|stop|pausa|bloc/.test(t)) return 'stop_search'
  if (/profil|aggiornam|skill|esperien/.test(t)) return 'update_profile'
  return 'unknown'
}

async function sessionExists(session: string): Promise<boolean> {
  const { stdout } = await runBash(
    `tmux has-session -t "${session}" 2>&1 && echo EXISTS || echo NONE`
  )
  return stdout.trim() === 'EXISTS'
}

/** GET — stato del bot assistente */
export async function GET() {
  try {
    const running = await sessionExists(ASSISTANT_SESSION)
    const captainUp = await sessionExists(CAPTAIN_SESSION)
    return NextResponse.json({
      running,
      captainUp,
      ownerChatId: process.env.JHT_OWNER_CHAT_ID ?? '',
      pendingRequests: 0,
    })
  } catch {
    return NextResponse.json({ running: false, captainUp: false, pendingRequests: 0 })
  }
}

/** POST — invia messaggio/intent all'assistente o direttamente al capitano */
export async function POST(req: NextRequest) {
  let body: { text?: string; userId?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }

  const text = (body.text ?? '').trim()
  if (!text) {
    return NextResponse.json({ ok: false, error: 'text obbligatorio' }, { status: 400 })
  }

  const intent = classifyIntent(text)

  // Invia al capitano via tmux se disponibile
  const captainUp = await sessionExists(CAPTAIN_SESSION).catch(() => false)
  if (captainUp) {
    const msg = `[ASSISTENTE WEB] ${text}`
    await runBash(`tmux send-keys -t "${CAPTAIN_SESSION}" ${JSON.stringify(msg)} Enter`)
  }

  // Ack immediato in base all'intent
  const acks: Record<string, string> = {
    job_search: 'Avvio ricerca lavoro — il team è al lavoro.',
    status_check: 'Recupero lo stato della pipeline.',
    list_applications: 'Carico la lista candidature.',
    stop_search: 'Fermo la ricerca in corso.',
    update_profile: 'Aggiorno il profilo con le nuove informazioni.',
    unknown: 'Messaggio ricevuto — lo passo al capitano.',
  }

  return NextResponse.json({
    ok: true,
    intent,
    ack: acks[intent] ?? acks.unknown,
    dispatched: captainUp,
  })
}
