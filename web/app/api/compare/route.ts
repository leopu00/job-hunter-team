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

const SAMPLE_JOBS: JobEntry[] = [
  { id: 'j1', title: 'Frontend Developer', company: 'Acme Corp', location: 'Milano', remote: 'hybrid',
    salaryMin: 35000, salaryMax: 42000, score: 85, matchedSkills: ['React', 'TypeScript', 'CSS'],
    missingSkills: ['GraphQL'], benefits: ['Buoni pasto', 'Smart working', 'Formazione'], appliedAt: Date.now() - 5 * 86_400_000, status: 'interview' },
  { id: 'j2', title: 'Senior React Engineer', company: 'TechFlow', location: 'Roma', remote: 'remote',
    salaryMin: 45000, salaryMax: 55000, score: 78, matchedSkills: ['React', 'TypeScript', 'Node.js'],
    missingSkills: ['AWS', 'Terraform'], benefits: ['Full remote', 'Stock options', 'Budget HW'], appliedAt: Date.now() - 3 * 86_400_000, status: 'applied' },
  { id: 'j3', title: 'Full Stack Developer', company: 'DataWise S.r.l.', location: 'Torino', remote: 'hybrid',
    salaryMin: 38000, salaryMax: 48000, score: 92, matchedSkills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
    missingSkills: [], benefits: ['Buoni pasto', 'Assicurazione', 'Flessibilità'], status: 'saved' },
  { id: 'j4', title: 'Backend Engineer', company: 'CloudBase', location: 'Milano', remote: 'on-site',
    salaryMin: 40000, salaryMax: 50000, score: 65, matchedSkills: ['Node.js', 'PostgreSQL'],
    missingSkills: ['Go', 'Kubernetes', 'gRPC'], benefits: ['Mensa', 'Palestra'], appliedAt: Date.now() - 7 * 86_400_000, status: 'rejected' },
  { id: 'j5', title: 'Tech Lead', company: 'CodeLab S.p.A.', location: 'Bologna', remote: 'hybrid',
    salaryMin: 55000, salaryMax: 65000, score: 72, matchedSkills: ['React', 'TypeScript', 'Node.js'],
    missingSkills: ['Team management', 'System design'], benefits: ['Auto aziendale', 'Bonus', 'Formazione'], appliedAt: Date.now() - 10 * 86_400_000, status: 'offer' },
  { id: 'j6', title: 'DevOps Engineer', company: 'NetPrime', location: 'Firenze', remote: 'remote',
    salaryMin: 42000, salaryMax: 52000, score: 45, matchedSkills: ['Docker'],
    missingSkills: ['Kubernetes', 'Terraform', 'AWS', 'CI/CD avanzato'], benefits: ['Full remote', 'Budget formazione'], status: 'saved' },
]

/** GET — ?ids=j1,j2,j3 per confronto, senza ids = lista disponibili */
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get('ids')

  if (!idsParam) {
    const list = SAMPLE_JOBS.map(j => ({ id: j.id, title: j.title, company: j.company, score: j.score, status: j.status }))
    return NextResponse.json({ available: list })
  }

  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  const jobs = ids.map(id => SAMPLE_JOBS.find(j => j.id === id)).filter(Boolean) as JobEntry[]
  if (jobs.length < 2) return NextResponse.json({ error: 'Servono almeno 2 candidature' }, { status: 400 })

  const bestScore = Math.max(...jobs.map(j => j.score))
  const bestSalary = Math.max(...jobs.map(j => j.salaryMax))

  return NextResponse.json({
    jobs, remoteLabels: REMOTE_LABEL,
    highlights: { bestScoreId: jobs.find(j => j.score === bestScore)?.id, bestSalaryId: jobs.find(j => j.salaryMax === bestSalary)?.id },
  })
}
