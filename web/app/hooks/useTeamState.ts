'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export interface TeamState {
  user_id: string
  should_run: boolean
  agents_enabled: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>
  restart_token: string | null
  is_running: boolean
  last_heartbeat_at: string | null
  last_restart_token: string | null
  active_device_id: string | null
  active_device_claimed_at: string | null
  last_user_activity_at: string | null
  last_action: string | null
  last_action_at: string | null
  last_error: string | null
  last_error_at: string | null
  created_at: string
  updated_at: string
}

export interface UserAgentMessage {
  id: string
  user_id: string
  agent: string
  message: string
  payload: Record<string, unknown>
  sent_at: string
  delivered_at: string | null
  replied_at: string | null
  status: 'pending' | 'delivered' | 'replied' | 'expired'
}

export interface PendingUserMessage {
  id: number
  agent: string
  body: string
  kind: string | null
  created_at: string
}

export interface PositionFeedback {
  id: string
  user_id: string
  position_legacy_id: string
  action: 'like' | 'dislike' | 'hide' | 'star'
  reason: string | null
  created_at: string
}

type DesiredPatch = Partial<
  Pick<TeamState, 'should_run' | 'agents_enabled' | 'restart_token' | 'last_user_activity_at'>
>

interface PostgrestLike<T> {
  data: T | null
  error: { message: string } | null
}

/**
 * Subscribe live a team_state per l'utente loggato.
 *
 * Initial fetch via REST + subscription Realtime su INSERT/UPDATE/DELETE.
 * Tutte le mutation passano per /api/team-state (PATCH); il server filtra
 * i campi scrivibili per source (browser = desired only).
 */
export function useTeamState(userId: string | null) {
  const [state, setState] = useState<TeamState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    let cancelled = false

    void (async () => {
      // Auth del Realtime channel con il JWT user. Senza questo passo il
      // channel parte con role anon → RLS blocca tutti gli eventi
      // postgres_changes. Discovered nel test E2E 2026-05-23: il browser
      // restava in waiting indefinitamente nonostante DB scritto.
      const session = (await supabase.auth.getSession()) as {
        data: { session: { access_token: string } | null }
        error: { message: string } | null
      }
      if (cancelled) return
      const jwt = session.data.session?.access_token
      if (jwt && supabase.realtime?.setAuth) {
        supabase.realtime.setAuth(jwt)
      }

      const res = (await supabase
        .from('team_state')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()) as PostgrestLike<TeamState>
      if (cancelled) return
      if (res.error) setError(res.error.message)
      else setState(res.data ?? null)
      setLoading(false)
    })()

    const channel = supabase
      .channel(`team_state:${userId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'team_state',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<TeamState>) => {
          if (cancelled) return
          if (payload.eventType === 'DELETE') setState(null)
          else setState(payload.new as TeamState)
        }
      )
      .subscribe()

    // Polling fallback (5s): se il Realtime broadcast non arriva (es. RLS,
    // network filtered, subscription stale), il polling garantisce che il
    // browser veda comunque i cambi observed scritti dal container.
    // Light query: una SELECT su PK user_id con filtro RLS. Quando Realtime
    // funziona, il polling è ridondante ma idempotente.
    const pollInterval = setInterval(async () => {
      if (cancelled) return
      const r = (await supabase
        .from('team_state')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle()) as PostgrestLike<TeamState>
      if (cancelled) return
      if (!r.error) setState(r.data ?? null)
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(pollInterval)
      supabase.removeChannel(channel)
    }
  }, [userId])

  const patchDesired = useCallback(async (partial: DesiredPatch): Promise<TeamState> => {
    const res = await fetch('/api/team-state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Costruisco un messaggio leggibile (Error con .message stringa) anche
      // quando il server ritorna error come oggetto annidato. Evita il
      // "[object Object]" nel toast del caller.
      const msg =
        typeof body.error === 'string'
          ? body.error
          : body.message ?? `HTTP ${res.status}`
      throw new Error(msg)
    }
    // Optimistic update: aggiorno subito lo state locale col valore appena
    // confermato dal server, senza aspettare il broadcast Realtime. La
    // subscription sovrascriverà comunque se arriva, ma il bottone reagisce
    // immediato all'azione utente.
    setState((body.state as TeamState) ?? null)
    return body.state as TeamState
  }, [])

  const start = useCallback(() => patchDesired({ should_run: true }), [patchDesired])
  const stop = useCallback(() => patchDesired({ should_run: false }), [patchDesired])
  const restart = useCallback(
    () => patchDesired({ restart_token: crypto.randomUUID() }),
    [patchDesired]
  )
  const bumpActivity = useCallback(
    () => patchDesired({ last_user_activity_at: new Date().toISOString() }),
    [patchDesired]
  )
  const setAgentEnabled = useCallback(
    (agent: string, enabled: boolean) => {
      const current = state?.agents_enabled ?? {}
      const next = { ...current, [agent]: { ...(current[agent] ?? {}), enabled } }
      return patchDesired({ agents_enabled: next })
    },
    [patchDesired, state]
  )

  return { state, loading, error, start, stop, restart, bumpActivity, setAgentEnabled, patchDesired }
}

/**
 * Chat utente → agente. Lista live + send via /api/messages.
 */
export function useUserAgentMessages(userId: string | null, limit = 50) {
  const [messages, setMessages] = useState<UserAgentMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    let cancelled = false

    void (async () => {
      const res = (await supabase
        .from('user_to_agent_messages')
        .select('*')
        .eq('user_id', userId)
        .order('sent_at', { ascending: false })
        .limit(limit)) as PostgrestLike<UserAgentMessage[]>
      if (cancelled) return
      if (res.error) setError(res.error.message)
      else setMessages(res.data ?? [])
      setLoading(false)
    })()

    const channel = supabase
      .channel(`user_to_agent_messages:${userId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'user_to_agent_messages',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<UserAgentMessage>) => {
          if (cancelled) return
          setMessages((prev) => {
            if (payload.eventType === 'INSERT')
              return [payload.new as UserAgentMessage, ...prev].slice(0, limit)
            if (payload.eventType === 'UPDATE') {
              const updated = payload.new as UserAgentMessage
              return prev.map((m) => (m.id === updated.id ? updated : m))
            }
            if (payload.eventType === 'DELETE') {
              const oldRow = payload.old as { id?: string }
              return prev.filter((m) => m.id !== oldRow.id)
            }
            return prev
          })
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId, limit])

  const send = useCallback(
    async (agent: string, message: string, payload: Record<string, unknown> = {}): Promise<UserAgentMessage> => {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, message, payload }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      return body.message as UserAgentMessage
    },
    []
  )

  return { messages, loading, error, send }
}

/**
 * Risposte agente → utente (tabella pending_user_messages già esistente).
 * Browser-only subscribe; il container li produce.
 */
export function usePendingUserMessages(userId: string | null, limit = 50) {
  const [messages, setMessages] = useState<PendingUserMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    let cancelled = false

    void (async () => {
      const res = (await supabase
        .from('pending_user_messages')
        .select('id, agent, body, kind, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)) as PostgrestLike<PendingUserMessage[]>
      if (cancelled) return
      if (res.error) setError(res.error.message)
      else setMessages(res.data ?? [])
      setLoading(false)
    })()

    const channel = supabase
      .channel(`pending_user_messages:${userId}`)
      .on(
        'postgres_changes' as never,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pending_user_messages',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<PendingUserMessage>) => {
          if (cancelled) return
          setMessages((prev) => [payload.new as PendingUserMessage, ...prev].slice(0, limit))
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId, limit])

  return { messages, loading, error }
}

/**
 * Feedback like/dislike per una position specifica. Live + send via POST.
 */
export function usePositionFeedback(userId: string | null, legacyId: string | null) {
  const [feedback, setFeedback] = useState<PositionFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId || !legacyId) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    let cancelled = false

    void (async () => {
      const res = (await supabase
        .from('position_feedback')
        .select('*')
        .eq('user_id', userId)
        .eq('position_legacy_id', legacyId)
        .order('created_at', { ascending: false })) as PostgrestLike<PositionFeedback[]>
      if (cancelled) return
      if (res.error) setError(res.error.message)
      else setFeedback(res.data ?? [])
      setLoading(false)
    })()

    const channel = supabase
      .channel(`position_feedback:${userId}:${legacyId}`)
      .on(
        'postgres_changes' as never,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'position_feedback',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<PositionFeedback>) => {
          if (cancelled) return
          const row = payload.new as PositionFeedback
          if (row.position_legacy_id !== legacyId) return
          setFeedback((prev) => [row, ...prev])
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId, legacyId])

  const submit = useCallback(
    async (action: 'like' | 'dislike' | 'hide' | 'star', reason?: string): Promise<PositionFeedback> => {
      if (!legacyId) throw new Error('legacyId mancante')
      const res = await fetch(`/api/positions/${encodeURIComponent(legacyId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      return body.feedback as PositionFeedback
    },
    [legacyId]
  )

  return { feedback, loading, error, submit }
}
