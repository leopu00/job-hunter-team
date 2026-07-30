import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'

export const dynamic = 'force-dynamic'

const STORE_PATH = path.join(os.homedir(), '.jht', 'skills', 'skills.json')

type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert'
type SkillCategory = 'frontend' | 'backend' | 'devops' | 'soft-skills' | 'languages'

interface Skill {
  id: string
  name: string
  level: SkillLevel
  category: SkillCategory
  endorsements: number
}

interface SkillStore { version: 1; skills: Skill[] }

const LEVEL_SCORE: Record<SkillLevel, number> = { beginner: 25, intermediate: 50, advanced: 75, expert: 100 }

const SAMPLE_SKILLS: Skill[] = [
  { id: 's1', name: 'React', level: 'advanced', category: 'frontend', endorsements: 12 },
  { id: 's2', name: 'TypeScript', level: 'advanced', category: 'frontend', endorsements: 9 },
  { id: 's3', name: 'CSS/Tailwind', level: 'intermediate', category: 'frontend', endorsements: 5 },
  { id: 's4', name: 'Node.js', level: 'advanced', category: 'backend', endorsements: 8 },
  { id: 's5', name: 'Python', level: 'intermediate', category: 'backend', endorsements: 6 },
  { id: 's6', name: 'PostgreSQL', level: 'intermediate', category: 'backend', endorsements: 4 },
  { id: 's7', name: 'Docker', level: 'intermediate', category: 'devops', endorsements: 3 },
  { id: 's8', name: 'CI/CD', level: 'beginner', category: 'devops', endorsements: 2 },
  { id: 's9', name: 'Comunicazione', level: 'expert', category: 'soft-skills', endorsements: 7 },
  { id: 's10', name: 'Problem Solving', level: 'advanced', category: 'soft-skills', endorsements: 10 },
  { id: 's11', name: 'Italiano', level: 'expert', category: 'languages', endorsements: 0 },
  { id: 's12', name: 'Inglese', level: 'advanced', category: 'languages', endorsements: 5 },
]

function load(): SkillStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as SkillStore
    return Array.isArray(parsed?.skills) ? parsed : { version: 1, skills: SAMPLE_SKILLS }
  } catch { return { version: 1, skills: SAMPLE_SKILLS } }
}

function save(store: SkillStore) {
  const dir = path.dirname(STORE_PATH)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = STORE_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
  fs.renameSync(tmp, STORE_PATH)
}

/** GET — lista skills con filtri: ?category=frontend&level=advanced */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const category = sp.get('category') as SkillCategory | null
  const level = sp.get('level') as SkillLevel | null

  const store = load()
  let skills = store.skills
  if (category) skills = skills.filter(s => s.category === category)
  if (level) skills = skills.filter(s => s.level === level)

  const top6 = [...store.skills].sort((a, b) => LEVEL_SCORE[b.level] - LEVEL_SCORE[a.level] || b.endorsements - a.endorsements).slice(0, 6)
    .map(s => ({ name: s.name, score: LEVEL_SCORE[s.level] }))

  const byCategory: Record<string, number> = {}
  for (const s of store.skills) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1

  return NextResponse.json({ skills, total: skills.length, radarTop6: top6, byCategory })
}

/** POST — aggiungi skill */
export async function POST(req: NextRequest) {
  let body: { name?: string; level?: SkillLevel; category?: SkillCategory } = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.name?.trim()) return NextResponse.json({ ok: false, error: 'name obbligatorio' }, { status: 400 })

  const store = load()
  const skill: Skill = {
    id: randomUUID(), name: body.name.trim(),
    level: body.level ?? 'beginner', category: body.category ?? 'frontend', endorsements: 0,
  }
  store.skills.push(skill)
  save(store)
  return NextResponse.json({ ok: true, skill }, { status: 201 })
}

/** DELETE — rimuovi skill: ?id=xxx */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id obbligatorio' }, { status: 400 })
  const store = load()
  const idx = store.skills.findIndex(s => s.id === id)
  if (idx === -1) return NextResponse.json({ ok: false, error: 'skill non trovata' }, { status: 404 })
  store.skills.splice(idx, 1)
  save(store)
  return NextResponse.json({ ok: true })
}
