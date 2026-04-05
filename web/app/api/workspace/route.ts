import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const COOKIE_NAME = 'jht_workspace'

export async function GET(req: NextRequest) {
  const wsPath = req.cookies.get(COOKIE_NAME)?.value || null

  if (!wsPath) {
    return NextResponse.json({ path: null, hasDb: false, hasProfile: false })
  }

  const hasDb = fs.existsSync(path.join(wsPath, 'jobs.db'))
  const hasProfile = fs.existsSync(path.join(wsPath, 'candidate_profile.yml'))

  return NextResponse.json({ path: wsPath, hasDb, hasProfile })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const wsPath = body.path as string | undefined

  if (!wsPath || typeof wsPath !== 'string') {
    return NextResponse.json({ error: 'path richiesto' }, { status: 400 })
  }

  // Sanitizza: rifiuta path con newline/CR/null (previene injection nel .env)
  if (/[\n\r\0]/.test(wsPath)) {
    return NextResponse.json({ error: 'path contiene caratteri non validi' }, { status: 400 })
  }

  // Verifica che esista ed e' una directory
  try {
    const stat = fs.statSync(wsPath)
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Il path non e\' una directory' }, { status: 400 })
    }
  } catch {
    // Se non esiste, la creiamo
    try {
      fs.mkdirSync(wsPath, { recursive: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Impossibile creare la directory'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  const hasDb = fs.existsSync(path.join(wsPath, 'jobs.db'))
  const hasProfile = fs.existsSync(path.join(wsPath, 'candidate_profile.yml'))

  const res = NextResponse.json({ ok: true, path: wsPath, hasDb, hasProfile })
  res.cookies.set(COOKIE_NAME, wsPath, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
  })

  // Aggiorna anche JHT_WORKSPACE nel .env del repo
  try {
    const envFile = path.resolve(process.cwd(), '..', '.env')
    if (fs.existsSync(envFile)) {
      let content = fs.readFileSync(envFile, 'utf-8')
      if (content.match(/^JHT_WORKSPACE=/m)) {
        content = content.replace(/^JHT_WORKSPACE=.*/m, `JHT_WORKSPACE=${wsPath}`)
      } else {
        content += `\nJHT_WORKSPACE=${wsPath}\n`
      }
      fs.writeFileSync(envFile, content, 'utf-8')
    }
  } catch { /* non critico */ }

  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, '', { path: '/', maxAge: 0 })
  return res
}
