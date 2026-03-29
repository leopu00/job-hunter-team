import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

const PARSE_PROMPT = `Analizza questo CV/documento PDF e estrai tutte le informazioni del candidato in formato JSON strutturato.

Il JSON deve seguire ESATTAMENTE questa struttura (usa null per i campi non trovati):

{
  "name": "Nome Cognome",
  "email": "email@example.com",
  "target_role": "Ruolo principale dedotto dal CV",
  "location": "Citta o Remote",
  "experience_years": 0,
  "has_degree": false,
  "skills": {
    "languages": [],
    "frameworks": [],
    "databases": [],
    "tools": [],
    "cloud": []
  },
  "languages": [{"language": "italiano", "level": "madrelingua"}],
  "job_titles": ["Ruolo 1", "Ruolo 2"],
  "positioning": {
    "contacts": {
      "email": "",
      "phone": "",
      "linkedin": "",
      "github": "",
      "website": ""
    },
    "experience": [
      {
        "role": "Titolo",
        "company": "Azienda",
        "period": "2020-2023",
        "description": "Breve descrizione",
        "highlights": ["Risultato 1", "Risultato 2"]
      }
    ],
    "education": [
      {"title": "Titolo di studio", "institution": "Istituto", "year": 2020, "notes": ""}
    ],
    "certifications": [
      {"name": "Cert", "issuer": "Ente", "year": 2021, "credential_id": ""}
    ],
    "projects": [
      {"name": "Progetto", "description": "Desc", "tech": ["Python"], "url": ""}
    ],
    "strengths": ["Punto di forza 1"]
  }
}

REGOLE:
- Rispondi SOLO con il JSON, senza testo aggiuntivo
- Deduci il target_role dal ruolo piu' recente o dal titolo del CV
- Calcola experience_years dalla prima esperienza lavorativa ad oggi
- Categorizza le skills in modo appropriato
- Se trovi contatti (email, telefono, LinkedIn, GitHub), mettili in positioning.contacts
- Ordina le esperienze dalla piu' recente alla piu' vecchia
- Se un campo non e' trovabile, usa null (non stringhe vuote)`

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY non configurata' },
      { status: 500 }
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'multipart form data richiesto' },
      { status: 400 }
    )
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'campo "file" richiesto' }, { status: 400 })
  }

  if (file.type !== 'application/pdf') {
    return NextResponse.json(
      { error: 'solo file PDF accettati (ricevuto: ' + file.type + ')' },
      { status: 400 }
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'file troppo grande (max 10 MB)' },
      { status: 400 }
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // Verifica magic bytes PDF (%PDF)
  if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
    return NextResponse.json(
      { error: 'il file non sembra un PDF valido' },
      { status: 400 }
    )
  }

  const base64 = buffer.toString('base64')

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64,
                },
              },
              {
                type: 'text',
                text: PARSE_PROMPT,
              },
            ],
          },
        ],
      }),
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const status = response.status
      return NextResponse.json(
        { error: `Errore API Anthropic (${status})` },
        { status: 502 }
      )
    }

    const data = await response.json()
    const text = data.content?.[0]?.text ?? ''

    // Prova a parsare il JSON dalla risposta
    let proposed_changes: Record<string, unknown> | null = null

    try {
      proposed_changes = JSON.parse(text)
    } catch {
      // Cerca un blocco JSON nella risposta
      const jsonMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
      if (jsonMatch) {
        try {
          proposed_changes = JSON.parse(jsonMatch[1])
        } catch { /* non parsabile */ }
      }
    }

    if (!proposed_changes) {
      return NextResponse.json(
        { error: 'impossibile estrarre dati strutturati dal PDF' },
        { status: 422 }
      )
    }

    return NextResponse.json({ proposed_changes })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'parsing PDF fallito'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
