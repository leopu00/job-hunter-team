import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

  const [queueRes, queueCountRes, recentScoredRes, recentExcludedRes, totalScoredRes, todayScoredRes] =
    await Promise.all([
      // Coda: status=checked, ultime 10
      supabase
        .from('positions')
        .select('id, title, company, location, remote_type, found_at, notes')
        .eq('status', 'checked')
        .order('found_at', { ascending: false })
        .limit(10),
      // Conteggio coda
      supabase
        .from('positions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'checked'),
      // Ultime 10 scored (score >= 40)
      supabase
        .from('scores')
        .select('position_id, total_score, scored_at, scored_by, positions(title, company, location, remote_type)')
        .gte('total_score', 40)
        .order('scored_at', { ascending: false })
        .limit(10),
      // Ultime 10 escluse dallo scorer (score < 40)
      supabase
        .from('scores')
        .select('position_id, total_score, scored_at, scored_by, positions(title, company, location, remote_type)')
        .lt('total_score', 40)
        .order('scored_at', { ascending: false })
        .limit(10),
      // Totale scored
      supabase
        .from('scores')
        .select('id', { count: 'exact', head: true }),
      // Scored oggi
      supabase
        .from('scores')
        .select('total_score')
        .gte('scored_at', todayISO),
    ])

  const todayScores = (todayScoredRes.data ?? []).map(s => s.total_score as number)
  const scoredToday = todayScores.length
  const excludedToday = todayScores.filter(s => s < 40).length
  const avgToday =
    scoredToday > 0
      ? +(todayScores.reduce((a, b) => a + b, 0) / scoredToday).toFixed(1)
      : null

  const mapScore = (s: any) => ({
    id: s.position_id,
    title: (s.positions as any)?.title ?? '—',
    company: (s.positions as any)?.company ?? '—',
    location: (s.positions as any)?.location ?? '',
    remote_type: (s.positions as any)?.remote_type ?? '',
    total_score: s.total_score,
    scored_at: s.scored_at,
    scored_by: s.scored_by,
  })

  return NextResponse.json({
    stats: {
      queue_size: queueCountRes.count ?? 0,
      scored_total: totalScoredRes.count ?? 0,
      scored_today: scoredToday,
      excluded_today: excludedToday,
      avg_score_today: avgToday,
    },
    queue: (queueRes.data ?? []).map(p => ({
      id: p.id,
      title: p.title,
      company: p.company,
      location: p.location,
      remote_type: p.remote_type,
      last_checked: p.found_at,
      notes: p.notes ?? '',
    })),
    recent_scored: (recentScoredRes.data ?? []).map(mapScore),
    recent_excluded: (recentExcludedRes.data ?? []).map(mapScore),
  })
}
