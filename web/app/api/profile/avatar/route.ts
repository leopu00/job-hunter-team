import { NextRequest, NextResponse } from 'next/server'
import { getWorkspacePath } from '@/lib/workspace'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_SIZE = 2 * 1024 * 1024 // 2 MB
const AVATAR_NAME = 'avatar'

function findAvatar(dir: string): string | null {
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const p = path.join(dir, AVATAR_NAME + ext)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** GET — serve avatar image or 204 if none */
export async function GET() {
  const workspace = await getWorkspacePath()
  if (!workspace) return new NextResponse(null, { status: 204 })

  const dir = path.join(workspace, 'profile')
  const avatarPath = findAvatar(dir)
  if (!avatarPath) return new NextResponse(null, { status: 204 })

  const ext = path.extname(avatarPath).slice(1)
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
  const buf = fs.readFileSync(avatarPath)
  return new NextResponse(buf, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' },
  })
}

/** POST — upload avatar (single image) */
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

  const file = formData.get('avatar') as File | null
  if (!file) {
    return NextResponse.json({ error: 'nessun file ricevuto' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Formato non supportato. Usa PNG, JPG o WebP.' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File troppo grande (max 2 MB).' }, { status: 400 })
  }

  const dir = path.join(workspace, 'profile')
  fs.mkdirSync(dir, { recursive: true })

  // Remove old avatars
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const old = path.join(dir, AVATAR_NAME + ext)
    if (fs.existsSync(old)) fs.unlinkSync(old)
  }

  const ext = file.type === 'image/webp' ? '.webp' : file.type === 'image/png' ? '.png' : '.jpg'
  const dest = path.join(dir, AVATAR_NAME + ext)
  const buffer = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(dest, buffer)

  return NextResponse.json({ ok: true })
}

/** DELETE — remove avatar */
export async function DELETE() {
  const workspace = await getWorkspacePath()
  if (!workspace) return NextResponse.json({ error: 'workspace non configurato' }, { status: 500 })

  const dir = path.join(workspace, 'profile')
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const p = path.join(dir, AVATAR_NAME + ext)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  return NextResponse.json({ ok: true })
}
