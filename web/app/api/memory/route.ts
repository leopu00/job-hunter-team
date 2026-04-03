import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const WORKSPACE = path.join(os.homedir(), '.jht')
const BOOTSTRAP_FILES = ['SOUL.md', 'IDENTITY.md', 'MEMORY.md', 'AGENTS.md', 'USER.md', 'TOOLS.md'] as const
type BootstrapFileName = (typeof BOOTSTRAP_FILES)[number]

function isValidFile(name: string): name is BootstrapFileName {
  return (BOOTSTRAP_FILES as readonly string[]).includes(name)
}

function readFile(name: string): { name: string; content: string; exists: boolean; size: number; updatedAt: number } {
  const filePath = path.join(WORKSPACE, name)
  try {
    const stat = fs.statSync(filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    return { name, content, exists: true, size: stat.size, updatedAt: stat.mtimeMs }
  } catch {
    return { name, content: '', exists: false, size: 0, updatedAt: 0 }
  }
}

function parseIdentity(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*[-*]\s*\*\*(\w+)\*\*[:\s]*(.+)/i)
    if (m) {
      const key = m[1].toLowerCase().trim()
      const val = m[2].replace(/[*_]/g, '').replace(/\(.*?\)/g, '').trim()
      if (val && !val.match(/pick something|ai\? robot|how do you come across|your signature/i)) {
        result[key] = val
      }
    }
  }
  return result
}

function parseSoulSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const headings = ['Core Truths', 'Boundaries', 'Vibe', 'Continuity']
  for (const heading of headings) {
    const re = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, 'mi')
    const m = content.match(re)
    if (m?.[1]?.trim()) sections[heading.toLowerCase().replace(' ', '_')] = m[1].trim()
  }
  return sections
}

/** GET — lista file memoria, opzionale ?file=SOUL.md per singolo file */
export async function GET(req: NextRequest) {
  const single = req.nextUrl.searchParams.get('file')
  if (single) {
    if (!isValidFile(single)) {
      return NextResponse.json({ ok: false, error: 'File non valido' }, { status: 400 })
    }
    const file = readFile(single)
    const meta: Record<string, unknown> = {}
    if (single === 'IDENTITY.md' && file.exists) meta.identity = parseIdentity(file.content)
    if (single === 'SOUL.md' && file.exists) meta.soul = parseSoulSections(file.content)
    return NextResponse.json({ ...file, ...meta })
  }
  const files = BOOTSTRAP_FILES.map(readFile)
  const identity = files.find(f => f.name === 'IDENTITY.md')
  const soul = files.find(f => f.name === 'SOUL.md')
  return NextResponse.json({
    files,
    identity: identity?.exists ? parseIdentity(identity.content) : null,
    soul: soul?.exists ? parseSoulSections(soul.content) : null,
    total: files.length,
    existing: files.filter(f => f.exists).length,
  })
}

/** PUT — aggiorna contenuto file: { file: "SOUL.md", content: "..." } */
export async function PUT(req: NextRequest) {
  let body: { file?: string; content?: string } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.file || !isValidFile(body.file)) {
    return NextResponse.json({ ok: false, error: 'File non valido' }, { status: 400 })
  }
  if (typeof body.content !== 'string') {
    return NextResponse.json({ ok: false, error: 'content obbligatorio' }, { status: 400 })
  }
  fs.mkdirSync(WORKSPACE, { recursive: true })
  fs.writeFileSync(path.join(WORKSPACE, body.file), body.content, 'utf-8')
  return NextResponse.json({ ok: true, file: body.file, size: Buffer.byteLength(body.content, 'utf-8') })
}
