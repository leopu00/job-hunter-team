import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00Z'

    const [queueRes, inProgressRes, completedRes, queueCountRes, writingTodayRes, completedTodayRes] = await Promise.all([
      // Queue: scored con score >= 50, ordinati per score DESC
      supabase
        .from('scores')
        .select('total_score, positions!inner(id, legacy_id, title, company, location, remote_type)')
        .eq('positions.status', 'scored')
        .gte('total_score', 50)
        .order('total_score', { ascending: false })
        .limit(15),
      // In progress: writing o review
      supabase
        .from('applications')
        .select('written_by, critic_score, critic_round, critic_verdict, positions!inner(id, legacy_id, title, company, total_score:score)')
        .in('positions.status', ['writing', 'review']),
      // Recent completed: con critic_verdict, ordinate per written_at DESC
      supabase
        .from('applications')
        .select('written_by, critic_score, critic_verdict, written_at, positions!inner(id, legacy_id, title, company, total_score:score)')
        .not('critic_verdict', 'is', null)
        .order('written_at', { ascending: false })
        .limit(10),
      // Queue size
      supabase
        .from('scores')
        .select('*', { count: 'exact', head: true })
        .gte('total_score', 50)
        .eq('positions.status', 'scored'),
      // Writing today
      supabase
        .from('applications')
        .select('*', { count: 'exact', head: true })
        .gte('written_at', todayStart),
      // Completed today con critic score
      supabase
        .from('applications')
        .select('critic_score')
        .not('critic_verdict', 'is', null)
        .gte('written_at', todayStart),
    ])

    // Queue: flatten join
    const queue = (queueRes.data ?? []).map((s: any) => ({
      id: s.positions.id,
      legacy_id: s.positions.legacy_id,
      title: s.positions.title,
      company: s.positions.company,
      location: s.positions.location,
      remote_type: s.positions.remote_type,
      total_score: s.total_score,
    }))

    // In progress: flatten join
    const in_progress = (inProgressRes.data ?? []).map((a: any) => ({
      id: a.positions.id,
      legacy_id: a.positions.legacy_id,
      title: a.positions.title,
      company: a.positions.company,
      total_score: a.positions.total_score,
      written_by: a.written_by,
      critic_score: a.critic_score,
      critic_round: a.critic_round,
      critic_verdict: a.critic_verdict,
    }))

    // Recent completed: flatten join
    const recent_completed = (completedRes.data ?? []).map((a: any) => ({
      id: a.positions.id,
      legacy_id: a.positions.legacy_id,
      title: a.positions.title,
      company: a.positions.company,
      total_score: a.positions.total_score,
      written_by: a.written_by,
      critic_score: a.critic_score,
      critic_verdict: a.critic_verdict,
      written_at: a.written_at,
    }))

    const queue_size = queueCountRes.count ?? queue.length
    const writing_today = writingTodayRes.count ?? 0
    const completedTodayData = completedTodayRes.data ?? []
    const completed_today = completedTodayData.length

    const criticScores = completedTodayData
      .map((r: { critic_score: number | null }) => r.critic_score)
      .filter((s: number | null): s is number => s != null)
    const avg_critic_score = criticScores.length > 0
      ? Math.round((criticScores.reduce((sum: number, s: number) => sum + s, 0) / criticScores.length) * 10) / 10
      : 0

    return NextResponse.json({
      queue,
      in_progress,
      recent_completed,
      queue_size,
      writing_today,
      completed_today,
      avg_critic_score,
    })
  } catch (error) {
    console.error('[scrittore-activity] error:', error)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
