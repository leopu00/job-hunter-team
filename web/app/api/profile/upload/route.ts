import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath } from '@/lib/workspace'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md', '.png', '.jpg', '.jpeg']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export async function POST(req: NextRequest) {
  const workspace = await getWorkspacePath()
  if (!workspace) {
    return NextResponse.json({ error: 'workspace non configurato' }, { status: 500 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'form data non valido' }, { status: 400 })
  }

  const files = formData.getAll('files') as File[]
  if (!files.length) {
    return NextResponse.json({ error: 'nessun file ricevuto' }, { status: 400 })
  }

  const uploadsDir = path.join(workspace, 'uploads')
  fs.mkdirSync(uploadsDir, { recursive: true })

  const saved: string[] = []
  const errors: string[] = []

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      errors.push(`${file.name}: tipo non consentito`)
      continue
    }
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name}: file troppo grande (max 10MB)`)
      continue
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const dest = path.join(uploadsDir, safeName)
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      fs.writeFileSync(dest, buffer)
      saved.push(safeName)
    } catch {
      errors.push(`${file.name}: errore di scrittura`)
    }
  }

  return NextResponse.json({ ok: true, saved, errors })
}
