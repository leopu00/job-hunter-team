import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath } from '@/lib/workspace'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params
  const workspace = await getWorkspacePath()
  if (!workspace) {
    return NextResponse.json({ error: 'workspace non configurato' }, { status: 500 })
  }

  const safeName = path.basename(decodeURIComponent(name))
  const filePath = path.join(workspace, 'profile', 'uploads', safeName)

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'file non trovato' }, { status: 404 })
  }

  const ext = path.extname(safeName).toLowerCase()
  const mime = MIME[ext] ?? 'application/octet-stream'
  const buf = fs.readFileSync(filePath)

  return new NextResponse(buf, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'no-cache',
    },
  })
}
