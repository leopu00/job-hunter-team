import { NextRequest, NextResponse } from 'next/server'
import { JHT_USER_UPLOADS_DIR } from '@/lib/jht-paths'
import { safeResolveUnder } from '@/lib/fs-safety'
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
  const safeName = path.basename(decodeURIComponent(name))
  const candidate = path.join(JHT_USER_UPLOADS_DIR, safeName)

  // basename() neutralizza ../ ma non un symlink piazzato manualmente
  // dentro JHT_USER_UPLOADS_DIR che punta fuori. realpath + containment
  // chiude la via.
  const realPath = safeResolveUnder(JHT_USER_UPLOADS_DIR, candidate)
  if (!realPath) {
    return NextResponse.json({ error: 'file non trovato' }, { status: 404 })
  }

  const ext = path.extname(safeName).toLowerCase()
  const mime = MIME[ext] ?? 'application/octet-stream'
  const buf = fs.readFileSync(realPath)

  return new NextResponse(buf, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'no-cache',
    },
  })
}
