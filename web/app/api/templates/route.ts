import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { JHT_HOME } from '@/lib/jht-paths'

export const dynamic = 'force-dynamic'

const TEMPLATES_DIR = path.join(JHT_HOME, 'templates')

type Frontmatter = Record<string, string | undefined>

type TemplateCategory = 'cover-letter' | 'follow-up' | 'thank-you' | 'referral' | 'salary'

interface TemplateSummary {
  name: string
  filePath: string
  title: string
  summary: string
  category: TemplateCategory
  variables: string[]
  charCount: number
}

interface TemplateDetail extends TemplateSummary {
  content: string
  frontmatter: Frontmatter
  raw: string
}

function getTemplatesDir(): string {
  return TEMPLATES_DIR
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
        category: (frontmatter.category as TemplateCategory) ?? 'cover-letter',
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

const SAMPLE_TEMPLATES: TemplateDetail[] = [
  { name: 'cover-letter-standard.md', filePath: '', title: 'Cover Letter Standard', summary: 'Lettera di presentazione generica per candidature', category: 'cover-letter',
    variables: ['nome', 'azienda', 'posizione', 'esperienza'], charCount: 280, frontmatter: { category: 'cover-letter' },
    content: 'Gentile team di {azienda},\n\nmi chiamo {nome} e scrivo per candidarmi alla posizione di {posizione}.\n\nCon {esperienza} anni di esperienza nel settore, sono convinto di poter contribuire significativamente al vostro team. La mia passione per la tecnologia e la mia esperienza pratica mi rendono un candidato ideale.\n\nResto a disposizione per un colloquio conoscitivo.\n\nCordiali saluti,\n{nome}',
    raw: '' },
  { name: 'follow-up-interview.md', filePath: '', title: 'Follow-up Post Colloquio', summary: 'Email di follow-up dopo un colloquio', category: 'follow-up',
    variables: ['nome', 'azienda', 'intervistatore', 'posizione'], charCount: 220, frontmatter: { category: 'follow-up' },
    content: 'Gentile {intervistatore},\n\nla ringrazio per il tempo dedicatomi durante il colloquio per la posizione di {posizione} presso {azienda}.\n\nLa conversazione ha rafforzato il mio interesse per il ruolo. Resto a disposizione per qualsiasi informazione aggiuntiva.\n\nCordiali saluti,\n{nome}',
    raw: '' },
  { name: 'thank-you-letter.md', filePath: '', title: 'Lettera di Ringraziamento', summary: 'Ringraziamento dopo offerta o colloquio', category: 'thank-you',
    variables: ['nome', 'azienda', 'contatto'], charCount: 180, frontmatter: { category: 'thank-you' },
    content: 'Gentile {contatto},\n\ndesidero ringraziarla per l\'opportunita\' offertami da {azienda}. Apprezzo molto la fiducia riposta in me e sono entusiasta di iniziare questa nuova avventura.\n\nCordiali saluti,\n{nome}',
    raw: '' },
  { name: 'referral-request.md', filePath: '', title: 'Richiesta Referral', summary: 'Richiesta di referral a un contatto', category: 'referral',
    variables: ['nome', 'contatto', 'azienda', 'posizione'], charCount: 240, frontmatter: { category: 'referral' },
    content: 'Ciao {contatto},\n\nspero tu stia bene! Ho visto che {azienda} sta cercando un {posizione} e so che lavori li\'.\n\nSaresti disponibile a fare una referral per la mia candidatura? Ti allego il mio CV aggiornato. Qualsiasi supporto sarebbe molto apprezzato.\n\nGrazie mille,\n{nome}',
    raw: '' },
  { name: 'salary-negotiation.md', filePath: '', title: 'Negoziazione RAL', summary: 'Template per negoziare lo stipendio', category: 'salary',
    variables: ['nome', 'azienda', 'posizione', 'ral_attuale', 'ral_richiesta'], charCount: 300, frontmatter: { category: 'salary' },
    content: 'Gentile team HR di {azienda},\n\nsono molto entusiasta dell\'offerta per la posizione di {posizione}. Dopo attenta valutazione, vorrei discutere la componente retributiva.\n\nConsiderando la mia esperienza e il benchmark di mercato, ritengo che una RAL di {ral_richiesta} rifletta meglio il valore che posso portare al team.\n\nSono aperto al dialogo e disponibile a trovare un accordo soddisfacente per entrambe le parti.\n\nCordiali saluti,\n{nome}',
    raw: '' },
]

/** GET — lista template: ?name=xxx&category=xxx */
export async function GET(req: NextRequest) {
  let templates = loadTemplates(getTemplatesDir())
  if (templates.length === 0) templates = SAMPLE_TEMPLATES

  const name = req.nextUrl.searchParams.get('name')
  const category = req.nextUrl.searchParams.get('category')

  if (name) {
    const tpl = templates.find(t => t.name === name)
    if (!tpl) return NextResponse.json({ ok: false, error: 'template non trovato' }, { status: 404 })
    return NextResponse.json({ template: tpl })
  }

  let summaries: TemplateSummary[] = templates.map(({ content, frontmatter, raw, ...rest }) => rest)
  if (category) summaries = summaries.filter(t => t.category === category)
  const categories = [...new Set(templates.map(t => t.category))].sort()
  return NextResponse.json({ templates: summaries, total: summaries.length, categories })
}

/** POST — preview con variabili: { name: "SOUL.md", variables: { nome: "Rex" } } */
export async function POST(req: NextRequest) {
  let body: { name?: string; variables?: Record<string, string> } = {}
  try { body = await req.json() } catch { /* ignore */ }

  if (!body.name) return NextResponse.json({ ok: false, error: 'name obbligatorio' }, { status: 400 })

  const filePath = path.join(getTemplatesDir(), body.name)
  if (!fs.existsSync(filePath)) return NextResponse.json({ ok: false, error: 'template non trovato' }, { status: 404 })

  const raw = fs.readFileSync(filePath, 'utf-8')
  const { content } = parseFrontmatter(raw)
  const rendered = body.variables ? substituteVars(content, body.variables) : content
  const unresolvedVars = extractVariables(rendered)

  return NextResponse.json({ ok: true, rendered, charCount: rendered.length, unresolvedVars })
}
