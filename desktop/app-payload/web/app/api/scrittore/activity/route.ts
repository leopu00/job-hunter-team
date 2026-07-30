import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const today = new Date().toISOString().slice(0, 10)

    // Coda: scored con score >= 50, join con scores, top 15 per score desc
    const { data: queueData } = await supabase
      .from('positions')
      .select('id, title, company, location, remote_type, notes, status, scores(total_score)')
      .eq('status', 'scored')
      .order('id', { ascending: false })
      .limit(30)

    // Filtra score >= 50 e ordina
    const queue = (queueData ?? [])
      .map((p: any) => ({ ...p, total_score: p.scores?.[0]?.total_score ?? p.scores?.total_score ?? null }))
      .filter((p: any) => p.total_score != null && p.total_score >= 50)
      .sort((a: any, b: any) => b.total_score - a.total_score)
      .slice(0, 15)

    // In progress: status writing o review
    const { data: inProgressData } = await supabase
      .from('positions')
      .select(`
        id, title, company, location, remote_type, status, notes,
        scores(total_score),
        applications(written_by, critic_score, critic_verdict, critic_round, written_at, critic_reviewed_at)
      `)
      .in('status', ['writing', 'review'])
      .order('id', { ascending: false })
      .limit(20)

    const inProgress = (inProgressData ?? []).map((p: any) => {
      const app = Array.isArray(p.applications) ? p.applications[0] : p.applications
      const score = Array.isArray(p.scores) ? p.scores[0] : p.scores
      return {
        ...p,
        total_score: score?.total_score ?? null,
        written_by: app?.written_by ?? null,
        critic_score: app?.critic_score ?? null,
        critic_verdict: app?.critic_verdict ?? null,
        critic_round: app?.critic_round ?? null,
        written_at: app?.written_at ?? null,
        critic_reviewed_at: app?.critic_reviewed_at ?? null,
        critic_active: p.status === 'review',
      }
    })

    // Ultimi 10 completati: status ready, con applicazione
    const { data: completedData } = await supabase
      .from('positions')
      .select(`
        id, title, company, location, remote_type, status,
        scores(total_score),
        applications(written_by, critic_score, critic_verdict, critic_round, written_at, critic_reviewed_at)
      `)
      .eq('status', 'ready')
      .order('last_checked', { ascending: false })
      .limit(10)

    const recentCompleted = (completedData ?? []).map((p: any) => {
      const app = Array.isArray(p.applications) ? p.applications[0] : p.applications
      const score = Array.isArray(p.scores) ? p.scores[0] : p.scores
      return {
        ...p,
        total_score: score?.total_score ?? null,
        written_by: app?.written_by ?? null,
        critic_score: app?.critic_score ?? null,
        critic_verdict: app?.critic_verdict ?? null,
        critic_round: app?.critic_round ?? null,
        critic_reviewed_at: app?.critic_reviewed_at ?? null,
      }
    })

    // Conteggi
    const { count: queueSize } = await supabase
      .from('positions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'scored')

    const { count: writingToday } = await supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .gte('written_at', today)

    const { count: completedToday } = await supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .not('critic_score', 'is', null)
      .gte('critic_reviewed_at', today)

    const { data: avgData } = await supabase
      .from('applications')
      .select('critic_score')
      .not('critic_score', 'is', null)
      .gte('critic_reviewed_at', today)

    let avgCriticScore: number | null = null
    if (avgData && avgData.length > 0) {
      const sum = avgData.reduce((acc: number, r: any) => acc + (r.critic_score ?? 0), 0)
      avgCriticScore = Math.round((sum / avgData.length) * 10) / 10
    }

    return NextResponse.json({
      queue,
      in_progress: inProgress,
      recent_completed: recentCompleted,
      queue_size: queueSize ?? 0,
      writing_today: writingToday ?? 0,
      completed_today: completedToday ?? 0,
      avg_critic_score: avgCriticScore,
    })
  } catch (err) {
    console.error('[scrittore/activity]', err)
    return NextResponse.json({
      queue: [], in_progress: [], recent_completed: [],
      queue_size: 0, writing_today: 0, completed_today: 0, avg_critic_score: null,
    })
  }
}
