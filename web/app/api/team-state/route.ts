import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/team-state/auth'

export const dynamic = 'force-dynamic'

const DESIRED_FIELDS = ['should_run', 'agents_enabled', 'restart_token', 'last_user_activity_at'] as const
const OBSERVED_FIELDS = ['is_running', 'last_heartbeat_at', 'last_restart_token', 'last_error', 'last_error_at', 'last_action', 'last_action_at'] as const

type DesiredField = (typeof DESIRED_FIELDS)[number]
type ObservedField = (typeof OBSERVED_FIELDS)[number]

export async function GET(req: NextRequest) {
  const resolved = await resolveUser(req)
  if (!resolved.ok) return resolved.res
  const { userId, supabase } = resolved.user

  const { data, error } = await supabase
    .from('team_state')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ state: data ?? null })
}

export async function PATCH(req: NextRequest) {
  const resolved = await resolveUser(req)
  if (!resolved.ok) return resolved.res
  const { source, userId, supabase } = resolved.user

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON body invalido' }, { status: 400 })
  }

  const allowed = source === 'token' ? OBSERVED_FIELDS : DESIRED_FIELDS
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key as DesiredField | ObservedField] = body[key]
  }

  const rejected = Object.keys(body).filter((k) => !(allowed as readonly string[]).includes(k))
  if (rejected.length > 0) {
    return NextResponse.json(
      { error: `Campi non scrivibili da source=${source}: ${rejected.join(', ')}` },
      { status: 403 }
    )
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nessun campo da aggiornare' }, { status: 400 })
  }

  if (typeof update.agents_enabled !== 'undefined') {
    if (typeof update.agents_enabled !== 'object' || Array.isArray(update.agents_enabled) || update.agents_enabled === null) {
      return NextResponse.json({ error: 'agents_enabled deve essere un oggetto JSON' }, { status: 400 })
    }
  }

  // Single-team enforcement: solo il device active può scrivere observed.
  // Browser (session) può sempre scrivere desired (un utente loggato è la
  // fonte di verità del desired, indipendentemente da quale device sta
  // runnando). Token non-active viene rifiutato per non sporcare lo stato.
  if (source === 'token') {
    const tsCheck = (await supabase
      .from('team_state')
      .select('active_device_id')
      .eq('user_id', userId)
      .maybeSingle()) as {
      data: { active_device_id: string | null } | null
      error: { message: string } | null
    }
    if (
      tsCheck.data &&
      tsCheck.data.active_device_id &&
      tsCheck.data.active_device_id !== resolved.user.token.tokenId
    ) {
      return NextResponse.json(
        {
          error: 'not_active_device',
          message:
            "Questo device non è più il team attivo. PATCH observed rifiutata: " +
            "fai POST /api/team-state/claim {\"force\":true} per riprendere il controllo.",
          active_device_id: tsCheck.data.active_device_id,
        },
        { status: 409 }
      )
    }
  }

  const { data, error } = await supabase
    .from('team_state')
    .upsert({ user_id: userId, ...update }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ state: data })
}
