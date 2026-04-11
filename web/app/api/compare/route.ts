import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface JobEntry {
  id: string
  title: string
  company: string
  location: string
  remote: 'on-site' | 'hybrid' | 'remote'
  salaryMin: number
  salaryMax: number
  score: number
  matchedSkills: string[]
  missingSkills: string[]
  benefits: string[]
  appliedAt?: number
  status: 'saved' | 'applied' | 'interview' | 'offer' | 'rejected'
}

const REMOTE_LABEL: Record<string, string> = { 'on-site': 'In sede', hybrid: 'Ibrido', remote: 'Full remote' }

/** GET — ?ids=j1,j2,j3 per confronto, senza ids = lista disponibili */
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get('ids')

  // TODO: load real jobs from data source
  const jobs: JobEntry[] = []

  if (!idsParam) {
    const list = jobs.map(j => ({ id: j.id, title: j.title, company: j.company, score: j.score, status: j.status }))
    return NextResponse.json({ available: list })
  }

  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  const matched = ids.map(id => jobs.find(j => j.id === id)).filter(Boolean) as JobEntry[]
  if (matched.length < 2) return NextResponse.json({ error: 'Servono almeno 2 candidature' }, { status: 400 })

  const bestScore = Math.max(...jobs.map(j => j.score))
  const bestSalary = Math.max(...jobs.map(j => j.salaryMax))

  return NextResponse.json({
    jobs: matched, remoteLabels: REMOTE_LABEL,
    highlights: { bestScoreId: jobs.find(j => j.score === bestScore)?.id, bestSalaryId: jobs.find(j => j.salaryMax === bestSalary)?.id },
  })
}
