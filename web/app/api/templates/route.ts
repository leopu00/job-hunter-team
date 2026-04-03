import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export const dynamic = 'force-dynamic'

const CONFIG_PATH = path.join(os.homedir(), '.jht', 'jht.config.json')

type Frontmatter = Record<string, string | undefined>

interface TemplateSummary {
  name: string
  filePath: string
  title: string
  summary: string
  variables: string[]
  charCount: number
}

interface TemplateDetail extends TemplateSummary {
  content: string
  frontmatter: Frontmatter
  raw: string
}

function getWorkspace(): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    return typeof cfg.workspace === 'string' ? cfg.workspace : null
  } catch { return null }
}

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; content: string } {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) return { frontmatter: {}, content: raw }
  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx === -1) return { frontmatter: {}, content: raw }
  const fmBlock = trimmed.slice(3, endIdx).trim()
  const content = trimmed.slice(endIdx + 3).trimStart()
  const frontmatter: Frontmatter = {}
  for (const line of fmBlock.split('\n')) {
    const ci = line.indexOf(':')
    if (ci === -1) continue
    const key = line.slice(0, ci).trim()
    const val = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '')
    if (key && val) frontmatter[key] = val
  }
  return { frontmatter, content }
}

function extractVariables(text: string): string[] {
  const names = new Set<string>()
  const re = /\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) names.add(m[1])
  return [...names]
}

function substituteVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g, (match, key: string) => {
    const lk = key.toLowerCase()
    for (const [k, v] of Object.entries(vars)) {
      if (k.toLowerCase() === lk) return v
    }
    return match
  })
}

function loadTemplates(dir: string): TemplateDetail[] {
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
  const result: TemplateDetail[] = []
  for (const file of files) {
    const filePath = path.join(dir, file)
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      if (!raw.trim()) continue
      const { frontmatter, content } = parseFrontmatter(raw)
      result.push({
        name: file,
        filePath,
        title: frontmatter.title ?? file.replace('.md', ''),
        summary: frontmatter.summary ?? content.slice(0, 120),
        variables: extractVariables(content),
        charCount: content.length,
        content,
        frontmatter,
        raw,
      })
    } catch { /* skip */ }
  }
  return result
}

/** GET — lista template: ?name=SOUL.md per dettaglio singolo */
export async function GET(req: NextRequest) {
  const workspace = getWorkspace()
  if (!workspace) return NextResponse.json({ templates: [], error: 'workspace non configurato' })

  const templates = loadTemplates(workspace)
  const name = req.nextUrl.searchParams.get('name')

  if (name) {
    const tpl = templates.find(t => t.name === name)
    if (!tpl) return NextResponse.json({ ok: false, error: 'template non trovato' }, { status: 404 })
    return NextResponse.json({ template: tpl })
  }

  const summaries: TemplateSummary[] = templates.map(({ content, frontmatter, raw, ...rest }) => rest)
  return NextResponse.json({ templates: summaries, total: summaries.length })
}

/** POST — preview con variabili: { name: "SOUL.md", variables: { nome: "Rex" } } */
export async function POST(req: NextRequest) {
  let body: { name?: string; variables?: Record<string, string> } = {}
  try { body = await req.json() } catch { /* ignore */ }

  if (!body.name) return NextResponse.json({ ok: false, error: 'name obbligatorio' }, { status: 400 })

  const workspace = getWorkspace()
  if (!workspace) return NextResponse.json({ ok: false, error: 'workspace non configurato' }, { status: 400 })

  const filePath = path.join(workspace, body.name)
  if (!fs.existsSync(filePath)) return NextResponse.json({ ok: false, error: 'template non trovato' }, { status: 404 })

  const raw = fs.readFileSync(filePath, 'utf-8')
  const { content } = parseFrontmatter(raw)
  const rendered = body.variables ? substituteVars(content, body.variables) : content
  const unresolvedVars = extractVariables(rendered)

  return NextResponse.json({ ok: true, rendered, charCount: rendered.length, unresolvedVars })
}
