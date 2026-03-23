import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00Z'

    const [recentRes, todayRes, newCountRes] = await Promise.all([
      supabase
        .from('positions')
        .select('id, legacy_id, title, company, found_by, found_at, source, location, remote_type')
        .order('found_at', { ascending: false })
        .limit(30),
      supabase
        .from('positions')
        .select('found_by')
        .gte('found_at', todayStart),
      supabase
        .from('positions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new'),
    ])

    const recent_positions = recentRes.data ?? []
    const todayData = todayRes.data ?? []
    const total_new = newCountRes.count ?? 0
    const total_found_today = todayData.length

    // Scout stats: raggruppa per found_by, conta posizioni trovate oggi
    const scoutMap: Record<string, { count: number; last: typeof recent_positions[0] | null }> = {}
    for (const row of todayData) {
      const scout = row.found_by ?? 'sconosciuto'
      if (!scoutMap[scout]) scoutMap[scout] = { count: 0, last: null }
      scoutMap[scout].count++
    }

    // Per ogni scout, trova l'ultimo inserimento dalle posizioni recenti
    for (const pos of recent_positions) {
      const scout = pos.found_by ?? 'sconosciuto'
      if (scoutMap[scout] && !scoutMap[scout].last) {
        scoutMap[scout].last = pos
      }
    }

    const scout_stats = Object.entries(scoutMap).map(([scout, s]) => ({
      scout,
      positions_found_today: s.count,
      last_insert: s.last ? {
        id: s.last.id,
        legacy_id: s.last.legacy_id,
        title: s.last.title,
        company: s.last.company,
        found_at: s.last.found_at,
      } : null,
    }))

    return NextResponse.json({
      recent_positions,
      total_found_today,
      total_new,
      scout_stats,
    })
  } catch (error) {
    console.error('[scout-activity] error:', error)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
