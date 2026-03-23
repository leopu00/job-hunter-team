import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const { data: apps, error } = await supabase
    .from('applications')
    .select(`
      id, status, critic_score, critic_verdict, critic_round,
      critic_reviewed_at, written_at, written_by, reviewed_by,
      positions ( id, title, company )
    `)
    .or('status.eq.review,critic_verdict.not.is.null')
    .order('critic_reviewed_at', { ascending: false, nullsFirst: false })

  if (error || !apps) {
    return NextResponse.json({ error: error?.message ?? 'query error' }, { status: 500 })
  }

  // Stats globali
  const allReviewed = apps.filter(a => a.critic_verdict != null)
  const pass        = allReviewed.filter(a => a.critic_verdict === 'PASS').length
  const needsWork   = allReviewed.filter(a => a.critic_verdict === 'NEEDS_WORK').length
  const reject      = allReviewed.filter(a => a.critic_verdict === 'REJECT').length
  const scores      = allReviewed.map(a => a.critic_score).filter((s): s is number => s != null)
  const avgScore    = scores.length > 0 ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null

  // Coda: status='review' AND critic_score IS NULL
  const queue = apps
    .filter(a => a.status === 'review' && a.critic_score == null)
    .map(a => ({
      id:         a.id,
      title:      (a.positions as any)?.title   ?? '—',
      company:    (a.positions as any)?.company ?? '—',
      written_by: a.written_by,
      written_at: a.written_at,
    }))

  // Feed: ultime 10 revisioni completate
  const feed = allReviewed.slice(0, 10).map(a => ({
    id:                 a.id,
    title:              (a.positions as any)?.title   ?? '—',
    company:            (a.positions as any)?.company ?? '—',
    critic_verdict:     a.critic_verdict,
    critic_score:       a.critic_score,
    critic_round:       a.critic_round,
    critic_reviewed_at: a.critic_reviewed_at,
    reviewed_by:        a.reviewed_by,
    written_by:         a.written_by,
  }))

  // Stats per agente (grouped by reviewed_by)
  const agentMap: Record<string, { total: number; pass: number; needsWork: number; reject: number }> = {}
  for (const a of allReviewed) {
    const key = a.reviewed_by ?? 'sconosciuto'
    if (!agentMap[key]) agentMap[key] = { total: 0, pass: 0, needsWork: 0, reject: 0 }
    agentMap[key].total++
    if (a.critic_verdict === 'PASS')       agentMap[key].pass++
    if (a.critic_verdict === 'NEEDS_WORK') agentMap[key].needsWork++
    if (a.critic_verdict === 'REJECT')     agentMap[key].reject++
  }
  const byAgent = Object.entries(agentMap)
    .map(([critico, s]) => ({ critico, ...s }))
    .sort((a, b) => b.total - a.total)

  return NextResponse.json({
    stats: { total: allReviewed.length, pending: queue.length, pass, needsWork, reject, avgScore },
    queue,
    feed,
    byAgent,
  })
}
