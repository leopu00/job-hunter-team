import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Dispatch comando team via Supabase Realtime bus. Inserisce una riga
// in team_commands; il subscriber sulla VPS (shared/daemon/realtime-
// subscriber.js) riceve l'evento via WebSocket Realtime e esegue
// `jht team start/stop/restart` dentro il container. Il client può
// fare SELECT sulla stessa riga (RLS=own) per il feedback di
// processing (status: pending → running → done|error).
//
// Body: { action: 'start' | 'stop' | 'restart', payload?: object }
// Response: { ok: true, command: { id, status, requested_at } }
//
// Vedi migration 012_team_commands.sql per lo schema.

const VALID_ACTIONS = new Set(['start', 'stop', 'restart'])

export async function POST(req: NextRequest) {
  const authBlock = await requireAuth()
  if (authBlock) return authBlock

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 })
  }

  let body: { action?: string; payload?: Record<string, unknown> } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const action = String(body.action || '').trim().toLowerCase()
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: `invalid action: must be one of ${[...VALID_ACTIONS].join(', ')}` },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('team_commands')
    .insert({
      user_id: user.id,
      action,
      payload: body.payload || {},
    })
    .select('id, status, requested_at')
    .single()

  if (error) {
    return NextResponse.json(
      { ok: false, error: `insert failed: ${error.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, command: data })
}
