import { NextResponse } from 'next/server'
import {
  AI_ASSISTANT_SUGGESTIONS,
  buildAssistantSystemPrompt,
  normalizeAssistantHistory,
  type AssistantChatMessage,
} from '@/lib/ai-assistant'

export const dynamic = 'force-dynamic'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const DEFAULT_MODEL = 'gpt-4o-mini'
const MAX_CONTEXT_MESSAGES = 12
const MAX_OUTPUT_TOKENS = 450

type AssistantRequestBody = {
  message?: string
  history?: AssistantChatMessage[]
  path?: string
}

function getAssistantConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
  const model = process.env.JHT_AI_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL
  return { apiKey, model, configured: apiKey.length > 0 }
}

function buildInput(history: AssistantChatMessage[], message: string) {
  const conversation = normalizeAssistantHistory(history).slice(-MAX_CONTEXT_MESSAGES)
  const priorMessages = conversation.map(entry => ({
    role: entry.role,
    content: [{ type: 'input_text', text: entry.content }],
  }))

  return [
    ...priorMessages,
    { role: 'user', content: [{ type: 'input_text', text: message }] },
  ]
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''

  const candidate = payload as {
    output_text?: unknown
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
  }

  if (typeof candidate.output_text === 'string' && candidate.output_text.trim()) {
    return candidate.output_text.trim()
  }

  const chunks = (candidate.output ?? [])
    .filter(item => item?.type === 'message')
    .flatMap(item => item.content ?? [])
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text?.trim() ?? '')
    .filter(Boolean)

  return chunks.join('\n').trim()
}

function extractUpstreamError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const error = (payload as { error?: { message?: unknown } }).error
  return typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : null
}

export async function GET() {
  const { configured, model } = getAssistantConfig()
  return NextResponse.json({
    history: [],
    suggestions: AI_ASSISTANT_SUGGESTIONS,
    configured,
    model,
  })
}

export async function POST(req: Request) {
  let body: AssistantRequestBody
  try {
    body = await req.json() as AssistantRequestBody
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  const message = body.message?.trim()
  if (!message) {
    return NextResponse.json({ error: 'Messaggio richiesto' }, { status: 400 })
  }

  const { apiKey, model, configured } = getAssistantConfig()
  if (!configured) {
    return NextResponse.json({
      error: 'Chatbot non configurato sul server. Imposta OPENAI_API_KEY per attivarlo.',
      configured: false,
    }, { status: 503 })
  }

  try {
    const upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: buildAssistantSystemPrompt(body.path),
        input: buildInput(body.history ?? [], message),
        max_output_tokens: MAX_OUTPUT_TOKENS,
      }),
      cache: 'no-store',
    })

    const requestId = upstream.headers.get('x-request-id')
    const payload = await upstream.json().catch(() => null)

    if (!upstream.ok) {
      const detail = extractUpstreamError(payload) ?? `Upstream OpenAI HTTP ${upstream.status}`
      return NextResponse.json({
        error: `Il provider AI non ha accettato la richiesta: ${detail}`,
        configured: true,
        requestId,
      }, { status: 502 })
    }

    const reply = extractResponseText(payload)
    if (!reply) {
      return NextResponse.json({
        error: 'Il provider AI ha restituito una risposta vuota.',
        configured: true,
        requestId,
      }, { status: 502 })
    }

    return NextResponse.json({
      reply,
      timestamp: Date.now(),
      model,
      requestId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore sconosciuto'
    return NextResponse.json({ error: `Richiesta al provider AI fallita: ${message}` }, { status: 500 })
  }
}
