import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { JHT_PROFILE_SUMMARIES_DIR } from '@/lib/jht-paths'
import { isLocalRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Mappa id del file (senza .md) → titolo leggibile per l'UI.
// Lista fissa voluta: l'agente NON deve inventare file con nomi diversi,
// altrimenti il frontend non sa come intitolarli. Per estendere la lista
// aggiungere qui + aggiornare il prompt dell'assistente.
const KNOWN_SUMMARIES: Record<string, { title: string; order: number }> = {
  about: { title: 'Chi sei', order: 1 },
  preferences: { title: 'Preferenze raccontate', order: 2 },
  goals: { title: 'Obiettivi e dream job', order: 3 },
  strengths: { title: 'Punti di forza', order: 4 },
}

type Summary = { id: string; title: string; content: string; updatedAt: number }

export async function GET() {
  // Solo utente locale (Electron → localhost). Se siamo dietro Supabase,
  // questi MD vivono sulla macchina dell'utente e non vanno esposti al cloud.
  if (!(await isLocalRequest())) {
    return NextResponse.json({ summaries: [] }, { status: 401 })
  }

  if (!fs.existsSync(JHT_PROFILE_SUMMARIES_DIR)) {
    return NextResponse.json({ summaries: [] })
  }

  const entries = fs.readdirSync(JHT_PROFILE_SUMMARIES_DIR)
    .filter(f => f.endsWith('.md'))
    .map((f): Summary | null => {
      const id = f.replace(/\.md$/, '')
      const meta = KNOWN_SUMMARIES[id]
      if (!meta) return null
      const full = path.join(JHT_PROFILE_SUMMARIES_DIR, f)
      try {
        const stat = fs.statSync(full)
        const content = fs.readFileSync(full, 'utf8').trim()
        if (!content) return null
        return { id, title: meta.title, content, updatedAt: stat.mtimeMs }
      } catch {
        return null
      }
    })
    .filter((s): s is Summary => s !== null)
    .sort((a, b) => {
      const oa = KNOWN_SUMMARIES[a.id]?.order ?? 99
      const ob = KNOWN_SUMMARIES[b.id]?.order ?? 99
      return oa - ob
    })

  return NextResponse.json({ summaries: entries })
}
