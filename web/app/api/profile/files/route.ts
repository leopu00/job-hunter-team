import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath } from '@/lib/workspace'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  const workspace = await getWorkspacePath()
  if (!workspace) return NextResponse.json({ files: [] })

  const uploadsDir = path.join(workspace, 'profile', 'uploads')
  if (!fs.existsSync(uploadsDir)) return NextResponse.json({ files: [] })

  try {
    const entries = fs.readdirSync(uploadsDir, { withFileTypes: true })
    const files = entries
      .filter(e => e.isFile())
      .map(e => {
        const stat = fs.statSync(path.join(uploadsDir, e.name))
        return { name: e.name, size: stat.size, modified: stat.mtimeMs }
      })
      .sort((a, b) => b.modified - a.modified)
    return NextResponse.json({ files })
  } catch {
    return NextResponse.json({ files: [] })
  }
}

export async function DELETE(req: NextRequest) {
  const workspace = await getWorkspacePath()
  if (!workspace) return NextResponse.json({ error: 'workspace non configurato' }, { status: 500 })

  const { name } = await req.json()
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'nome file richiesto' }, { status: 400 })
  }

  // Previeni path traversal
  const safeName = path.basename(name)
  const filePath = path.join(workspace, 'profile', 'uploads', safeName)

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'file non trovato' }, { status: 404 })
  }

  fs.unlinkSync(filePath)
  return NextResponse.json({ ok: true })
}
