import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-dynamic'

const STATE_PATH = path.join(os.homedir(), '.jht', 'onboarding.json')

type OnboardingState = {
  completed: boolean
  completedAt?: number
  skipped: boolean
  stepsCompleted: string[]
}

function load(): OnboardingState {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as OnboardingState
  } catch {
    return { completed: false, skipped: false, stepsCompleted: [] }
  }
}

function save(state: OnboardingState): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

export async function GET() {
  return NextResponse.json(load())
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'body non valido' }, { status: 400 }) }

  const state = load()

  if (body.skip === true) {
    state.skipped = true
    state.completed = true
    state.completedAt = Date.now()
    save(state)
    return NextResponse.json(state)
  }

  if (body.stepId && typeof body.stepId === 'string') {
    if (!state.stepsCompleted.includes(body.stepId)) {
      state.stepsCompleted.push(body.stepId)
    }
    save(state)
    return NextResponse.json(state)
  }

  if (body.complete === true) {
    state.completed = true
    state.completedAt = Date.now()
    save(state)
    return NextResponse.json(state)
  }

  if (body.reset === true) {
    const fresh: OnboardingState = { completed: false, skipped: false, stepsCompleted: [] }
    save(fresh)
    return NextResponse.json(fresh)
  }

  return NextResponse.json({ error: 'azione non valida' }, { status: 400 })
}
