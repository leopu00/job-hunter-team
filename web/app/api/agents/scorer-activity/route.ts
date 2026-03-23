import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00Z'

    const [queueRes, scoredRes, excludedRes, queueCountRes, scoredTotalRes, scoredTodayRes, excludedTodayRes] = await Promise.all([
      // Queue: posizioni checked pronte per scoring
      supabase
        .from('positions')
        .select('id, legacy_id, title, company, location, remote_type, source, last_checked, notes')
        .eq('status', 'checked')
        .order('last_checked', { ascending: false })
        .limit(10),
      // Recent scored (score >= 50)
      supabase
        .from('scores')
        .select('position_id, total_score, scored_at, scored_by, positions!inner(id, legacy_id, title, company, location, remote_type)')
        .gte('total_score', 50)
        .order('scored_at', { ascending: false })
        .limit(10),
      // Recent excluded by scorer (score < 40)
      supabase
        .from('scores')
        .select('position_id, total_score, scored_at, positions!inner(id, legacy_id, title, company, notes)')
        .lt('total_score', 40)
        .order('scored_at', { ascending: false })
        .limit(10),
      // Queue size
      supabase
        .from('positions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'checked'),
      // Scored total (score >= 50)
      supabase
        .from('scores')
        .select('*', { count: 'exact', head: true })
        .gte('total_score', 50),
      // Scored today
      supabase
        .from('scores')
        .select('total_score')
        .gte('scored_at', todayStart),
      // Excluded today by scorer (score < 40)
      supabase
        .from('scores')
        .select('*', { count: 'exact', head: true })
        .lt('total_score', 40)
        .gte('scored_at', todayStart),
    ])

    const queue = queueRes.data ?? []
    const queue_size = queueCountRes.count ?? 0
    const scored_total = scoredTotalRes.count ?? 0
    const scoredTodayData = scoredTodayRes.data ?? []
    const scored_today = scoredTodayData.length
    const excluded_today = excludedTodayRes.count ?? 0

    // Recent scored: flatten join
    const recent_scored = (scoredRes.data ?? []).map((s: any) => ({
      id: s.positions.id,
      legacy_id: s.positions.legacy_id,
      title: s.positions.title,
      company: s.positions.company,
      location: s.positions.location,
      remote_type: s.positions.remote_type,
      total_score: s.total_score,
      scored_at: s.scored_at,
      scored_by: s.scored_by,
    }))

    // Recent excluded: flatten join
    const recent_excluded = (excludedRes.data ?? []).map((s: any) => ({
      id: s.positions.id,
      legacy_id: s.positions.legacy_id,
      title: s.positions.title,
      company: s.positions.company,
      total_score: s.total_score,
      scored_at: s.scored_at,
      notes: s.positions.notes,
    }))

    // Avg score today
    const avg_score_today = scoredTodayData.length > 0
      ? Math.round((scoredTodayData.reduce((sum, s) => sum + s.total_score, 0) / scoredTodayData.length) * 10) / 10
      : 0

    return NextResponse.json({
      queue,
      recent_scored,
      recent_excluded,
      queue_size,
      scored_total,
      scored_today,
      excluded_today,
      avg_score_today,
    })
  } catch (error) {
    console.error('[scorer-activity] error:', error)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
