import { NextRequest, NextResponse } from 'next/server'
import { readJhtConfig } from '@/lib/jht-config'
import { runLLM, LLMError } from '@/lib/llm-client'
import { extractPdfText } from '@/lib/pdf-text'
import { isSupabaseConfigured } from '@/lib/workspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_PDF_BYTES = 10 * 1024 * 1024
const MAX_TEXT_CHARS = 60_000

const SYSTEM_PROMPT = `Sei un estrattore di dati strutturati da CV.
Riceverai il testo grezzo di un curriculum vitae estratto da un PDF.
Devi restituire un singolo oggetto JSON che segua esattamente lo schema richiesto.
Regole:
- Rispondi SOLO con JSON valido, senza markdown, senza commenti, senza testo prima o dopo.
- Se un campo non è deducibile, usa null (per stringhe/numeri) o array vuoto [].
- Non inventare dati che non compaiono nel CV.
- experience_years è un intero (anni totali di esperienza lavorativa stimati).
- skills è un oggetto { primary: string[], secondary: string[] } con i principali raggruppamenti tecnici/non.
- languages è un array di { language: string, level: string } dove level è CEFR (A1..C2) o "native" se madrelingua.
- location è la città o area geografica principale dichiarata.
- target_role è il ruolo che il candidato sta cercando; se il CV non lo dichiara esplicitamente, desumilo dall'ultima esperienza significativa.
- positioning.contacts include email, phone, linkedin, github, website se presenti nel CV.
- positioning.experience è un array di { company, role, years, summary } con le esperienze principali in ordine cronologico inverso.
- positioning.education è un array di { institution, degree, year }.`

const USER_PROMPT_TEMPLATE = (cvText: string) => `Estrai i dati del seguente CV e restituisci un JSON con questo schema:

{
  "name": string | null,
  "email": string | null,
  "location": string | null,
  "target_role": string | null,
  "experience_years": number | null,
  "has_degree": boolean,
  "skills": { "primary": string[], "secondary": string[] },
  "languages": [{ "language": string, "level": string }],
  "job_titles": string[],
  "salary_target": { "currency": string, "italy_min": number, "italy_max": number } | null,
  "seniority_target": "junior" | "mid" | "senior" | null,
  "positioning": {
    "contacts": {
      "email": string | null,
      "phone": string | null,
      "linkedin": string | null,
      "github": string | null,
      "website": string | null
    },
    "experience": [{ "company": string, "role": string, "years": string, "summary": string }],
    "education": [{ "institution": string, "degree": string, "year": string }],
    "strengths": string[],
    "free_notes": string
  }
}

Testo del CV:
"""
${cvText}
"""`

export async function POST(req: NextRequest) {
  if (isSupabaseConfigured && !process.env.JHT_ALLOW_CLOUD_EXTRACT) {
    return NextResponse.json(
      { error: 'estrazione AI disponibile solo in modalità locale (localhost)' },
      { status: 403 }
    )
  }

  const config = readJhtConfig()
  if (!config) {
    return NextResponse.json(
      { error: 'nessun provider AI configurato: completa il setup prima di usare l\'estrazione automatica' },
      { status: 412 }
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart form data richiesto' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'campo "file" richiesto' }, { status: 400 })

  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: `solo PDF accettati (ricevuto: ${file.type})` }, { status: 400 })
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: 'file troppo grande (max 10 MB)' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
    return NextResponse.json({ error: 'il file non sembra un PDF valido' }, { status: 400 })
  }

  let cvText: string
  try {
    cvText = await extractPdfText(buffer)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'parsing PDF fallito'
    return NextResponse.json({ error: `parsing PDF fallito: ${message}` }, { status: 422 })
  }

  if (!cvText) {
    return NextResponse.json({ error: 'nessun testo estratto dal PDF (forse è un PDF scansionato?)' }, { status: 422 })
  }
  if (cvText.length > MAX_TEXT_CHARS) {
    cvText = cvText.slice(0, MAX_TEXT_CHARS)
  }

  let llmOutput: string
  try {
    llmOutput = await runLLM(config, {
      system: SYSTEM_PROMPT,
      user: USER_PROMPT_TEMPLATE(cvText),
      maxTokens: 4096,
    })
  } catch (err) {
    if (err instanceof LLMError) {
      const status = err.code === 'auth' ? 401
        : err.code === 'not_configured' ? 412
        : err.code === 'unsupported' ? 501
        : err.code === 'timeout' ? 504
        : 502
      return NextResponse.json({ error: err.message, code: err.code }, { status })
    }
    const message = err instanceof Error ? err.message : 'errore LLM'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const profile = parseJsonFromLLM(llmOutput)
  if (!profile) {
    return NextResponse.json(
      { error: 'risposta LLM non valida: non è JSON parseable', raw: llmOutput.slice(0, 400) },
      { status: 502 }
    )
  }

  return NextResponse.json({
    ok: true,
    provider: config.active_provider,
    auth_method: config.providers[config.active_provider]?.auth_method ?? 'api_key',
    profile,
  })
}

function parseJsonFromLLM(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const candidates: string[] = [trimmed]

  // Strip code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) candidates.push(fenceMatch[1].trim())

  // First balanced { ... }
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1))

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      continue
    }
  }
  return null
}
