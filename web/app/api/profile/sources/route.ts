import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'
import { JHT_PROFILE_SOURCES_DIR } from '@/lib/jht-paths'
import { isLocalRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Ritorna la lista dei file archiviati dall'assistente come "fonte originale"
// del profilo utente: CV, lettere, certificati. NON la drop-zone grezza degli
// allegati (`$JHT_USER_DIR/allegati/`) — quella può contenere cose caricate per
// sbaglio. Questa directory la popola solo l'assistente, che decide cosa è
// rilevante sul candidato e cosa no.
type Source = {
  name: string
  size: number
  ext: string
  updatedAt: number
}

export async function GET() {
  if (!(await isLocalRequest())) {
    return NextResponse.json({ sources: [] }, { status: 401 })
  }

  if (!fs.existsSync(JHT_PROFILE_SOURCES_DIR)) {
    return NextResponse.json({ sources: [] })
  }

  const sources: Source[] = fs.readdirSync(JHT_PROFILE_SOURCES_DIR)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const full = path.join(JHT_PROFILE_SOURCES_DIR, f)
      try {
        const stat = fs.statSync(full)
        if (!stat.isFile()) return null
        return {
          name: f,
          size: stat.size,
          ext: path.extname(f).replace(/^\./, '').toLowerCase(),
          updatedAt: stat.mtimeMs,
        }
      } catch {
        return null
      }
    })
    .filter((s): s is Source => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return NextResponse.json({ sources })
}
