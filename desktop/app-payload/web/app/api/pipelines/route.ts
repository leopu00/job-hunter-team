import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const REPO  = 'leopu00/job-hunter-team'
const API   = `https://api.github.com/repos/${REPO}/actions/workflows`

type RunStatus    = 'success' | 'failure' | 'running' | 'cancelled' | 'unknown'
type RunConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | null

export interface Pipeline {
  id: string
  name: string
  file: string
  trigger: string
  status: RunStatus
  duration?: number   // secondi
  startedAt?: number  // ms
  runUrl?: string
  runNumber?: number
}

/** Workflow statici definiti in .github/workflows/ */
const STATIC_WORKFLOWS: Array<{ file: string; name: string; trigger: string }> = [
  { file: 'ci.yml',       name: 'CI',                    trigger: 'push / PR → master' },
  { file: 'test.yml',     name: 'Tests',                 trigger: 'push / PR → master' },
  { file: 'lint.yml',     name: 'Lint',                  trigger: 'push / PR → master' },
  { file: 'security.yml', name: 'Security',              trigger: 'push → master / schedule' },
  { file: 'deploy.yml',   name: 'Deploy Web → Vercel',   trigger: 'push → master' },
  { file: 'release.yml',  name: 'Release',               trigger: 'tag v*.*.*' },
]

function mapConclusion(conclusion: RunConclusion, status: string): RunStatus {
  if (status === 'in_progress' || status === 'queued') return 'running'
  if (conclusion === 'success') return 'success'
  if (conclusion === 'failure') return 'failure'
  if (conclusion === 'cancelled') return 'cancelled'
  return 'unknown'
}

async function fetchWithToken(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' },
    next: { revalidate: 60 },
  })
  if (!res.ok) return null
  return res.json()
}

/** GET — stato pipelines. Usa GITHUB_TOKEN se disponibile, altrimenti dati statici */
export async function GET() {
  const token = process.env.GITHUB_TOKEN ?? process.env.NEXT_PUBLIC_GITHUB_TOKEN

  if (!token) {
    // Fallback statico: mostra i workflow senza dati di run
    const pipelines: Pipeline[] = STATIC_WORKFLOWS.map(w => ({
      id: w.file, name: w.name, file: w.file, trigger: w.trigger, status: 'unknown',
    }))
    return NextResponse.json({ pipelines, source: 'static', repo: REPO })
  }

  // Recupera workflow list da GitHub API
  const wfList = await fetchWithToken(API, token).catch(() => null)
  const wfMap = new Map<string, number>()
  if (wfList?.workflows) {
    for (const wf of wfList.workflows) {
      wfMap.set(wf.path.replace('.github/workflows/', ''), wf.id)
    }
  }

  // Recupera ultimo run per ogni workflow
  const pipelines: Pipeline[] = await Promise.all(
    STATIC_WORKFLOWS.map(async w => {
      const base: Pipeline = { id: w.file, name: w.name, file: w.file, trigger: w.trigger, status: 'unknown' }
      const wfId = wfMap.get(w.file)
      if (!wfId) return base

      const runs = await fetchWithToken(`${API}/${wfId}/runs?per_page=1&branch=master`, token).catch(() => null)
      const run = runs?.workflow_runs?.[0]
      if (!run) return base

      const startMs = run.run_started_at ? new Date(run.run_started_at).getTime() : undefined
      const endMs   = run.updated_at      ? new Date(run.updated_at).getTime()      : undefined
      const duration = startMs && endMs ? Math.round((endMs - startMs) / 1000) : undefined

      return {
        ...base,
        status:    mapConclusion(run.conclusion, run.status),
        duration,
        startedAt: startMs,
        runUrl:    run.html_url,
        runNumber: run.run_number,
      }
    })
  )

  return NextResponse.json({ pipelines, source: 'github', repo: REPO })
}
