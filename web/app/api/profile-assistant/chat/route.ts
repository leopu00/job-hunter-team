import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

function getAnthropicKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const envFile = path.resolve(process.cwd(), '..', '.env')
    const content = fs.readFileSync(envFile, 'utf-8')
    const match = content.match(/^ANTHROPIC_API_KEY=(.+)$/m)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

const SYSTEM_PROMPT = `Sei l'assistente del profilo candidato nel Job Hunter Team.
Il tuo compito e' fare domande all'utente per raccogliere le informazioni necessarie al suo profilo professionale.

Le informazioni da raccogliere sono:
- Nome completo
- Email di contatto
- Ruolo target (es. Backend Developer, Data Scientist)
- Location preferita (es. Remote EU, Milano)
- Anni di esperienza
- Laurea (si/no)
- Skills tecniche (raggruppate per categoria: languages, frameworks, databases, tools, cloud)
- Lingue parlate con livello
- Preferenze location (remote, hybrid, onsite + dettagli)
- Ruoli target in ordine di priorita'
- Range salariale target (currency, min, max)
- Esperienze lavorative (ruolo, azienda, periodo, descrizione, highlights)
- Formazione (titolo, istituto, anno)
- Certificazioni (nome, ente, anno)
- Progetti personali (nome, descrizione, tech, url)
- Punti di forza

Regole:
1. Fai una domanda alla volta, non bombardare l'utente
2. Se l'utente fornisce piu' info insieme, riconoscile tutte
3. Quando hai raccolto abbastanza info, proponi un riepilogo
4. Rispondi SEMPRE in italiano
5. Sii conciso e professionale

Quando hai estratto dati dalla risposta dell'utente, DEVI includere alla fine della tua risposta un blocco JSON con i campi estratti, nel formato:

\`\`\`proposed_changes
{"campo": "valore", ...}
\`\`\`

I campi devono corrispondere alla struttura CandidateProfile:
- name, email, target_role, location: stringhe
- experience_years: numero
- has_degree: boolean
- skills: oggetto {languages: [...], frameworks: [...], databases: [...], tools: [...], cloud: [...]}
- languages: array [{language: "...", level: "..."}]
- location_preferences: array [{type: "..."}]
- job_titles: array di stringhe
- salary_target: {currency, italy_min, italy_max, remote_eu_min, remote_eu_max}
- positioning.experience: array [{role, company, period, description, highlights}]
- positioning.education: array [{title, institution, year}]
- positioning.certifications: array [{name, issuer, year}]
- positioning.projects: array [{name, description, tech, url}]
- positioning.strengths: array di stringhe
- positioning.contacts: {email, phone, linkedin, github, website}

Includi SOLO i campi che l'utente ha effettivamente menzionato in questo messaggio.
Se l'utente fa una domanda o chiacchiera senza dare dati profilo, NON includere il blocco proposed_changes.`

export async function POST(req: NextRequest) {
  const apiKey = getAnthropicKey()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY non configurata' },
      { status: 500 }
    )
  }

  let body: { message?: string; messages?: { role: string; content: string }[]; profile?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  }

  // Supporta sia singolo message che array messages (storico chat)
  let chatMessages: { role: string; content: string }[]

  if (body.messages && Array.isArray(body.messages)) {
    chatMessages = body.messages
  } else if (typeof body.message === 'string' && body.message.trim()) {
    chatMessages = [{ role: 'user', content: body.message.trim() }]
  } else {
    return NextResponse.json({ error: 'message o messages richiesto' }, { status: 400 })
  }

  // Aggiungi contesto profilo corrente al system prompt
  let systemWithContext = SYSTEM_PROMPT
  if (body.profile && Object.keys(body.profile).length > 0) {
    systemWithContext += `\n\nProfilo attuale del candidato:\n${JSON.stringify(body.profile, null, 2)}\n\nConcentrati sulle informazioni mancanti o incomplete.`
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)

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
        max_tokens: 1024,
        system: systemWithContext,
        messages: chatMessages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
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
    const fullReply = data.content?.[0]?.text ?? ''

    // Estrai blocco proposed_changes se presente
    let proposed_changes: Record<string, unknown> | null = null
    const match = fullReply.match(/```proposed_changes\s*\n([\s\S]*?)\n```/)
    if (match) {
      try {
        proposed_changes = JSON.parse(match[1])
      } catch { /* ignora errori di parsing */ }
    }

    // Rimuovi il blocco proposed_changes dal testo visibile
    const reply = fullReply.replace(/```proposed_changes\s*\n[\s\S]*?\n```/, '').trim()

    return NextResponse.json({ reply, proposed_changes })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'richiesta AI fallita'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
