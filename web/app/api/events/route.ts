import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

type SseClient = {
  agentId?: string
  stream?: string
  controller: ReadableStreamDefaultController<Uint8Array>
}

// Registro client SSE attivi (in-memory per processo Next.js)
const clients = new Set<SseClient>()

const enc = new TextEncoder()

function sseMessage(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Pubblica un evento a tutti i client SSE connessi (filtro opzionale per agentId/stream).
 * Chiamato da altre route o da server-side logic.
 */
export function publishEvent(event: string, data: unknown, agentId?: string, stream?: string): void {
  for (const client of clients) {
    if (agentId && client.agentId && client.agentId !== agentId) continue
    if (stream  && client.stream  && client.stream  !== stream)  continue
    try { client.controller.enqueue(sseMessage(event, data)) } catch { /* client disconnesso */ }
  }
}

/**
 * GET /api/events — SSE stream eventi real-time.
 * Query params: agentId (opzionale), stream (opzionale: lifecycle|tool|assistant|error)
 */
export async function GET(req: NextRequest) {
  const p       = req.nextUrl.searchParams
  const agentId = p.get('agentId') ?? undefined
  const stream  = p.get('stream')  ?? undefined

  let client: SseClient | null = null

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      client = { agentId, stream, controller }
      clients.add(client)
      // Heartbeat iniziale per confermare connessione
      controller.enqueue(sseMessage('connected', { ts: Date.now(), agentId, stream }))
    },
    cancel() {
      if (client) clients.delete(client)
    },
  })

  // Heartbeat ogni 25s per tenere viva la connessione
  const heartbeatId = setInterval(() => {
    if (!client) { clearInterval(heartbeatId); return }
    try { client.controller.enqueue(enc.encode(': heartbeat\n\n')) }
    catch { clients.delete(client!); clearInterval(heartbeatId) }
  }, 25_000)

  return new Response(body, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
