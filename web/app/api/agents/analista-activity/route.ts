import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { categorizeExclusion } from '@/lib/exclusion-categories'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00Z'

    const [queueRes, processedRes, excludedRes, queueCountRes, checkedCountRes, analyzedTodayRes, excludedTodayRes] = await Promise.all([
      supabase
        .from('positions')
        .select('id, legacy_id, title, company, location, remote_type, source, found_by, found_at, notes')
        .eq('status', 'new')
        .order('found_at', { ascending: false })
        .limit(10),
      supabase
        .from('positions')
        .select('id, legacy_id, title, company, location, remote_type, status, last_checked, notes')
        .eq('status', 'checked')
        .order('last_checked', { ascending: false })
        .limit(10),
      supabase
        .from('positions')
        .select('id, legacy_id, title, company, location, status, last_checked, notes')
        .eq('status', 'excluded')
        .not('last_checked', 'is', null)
        .order('last_checked', { ascending: false })
        .limit(10),
      supabase
        .from('positions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new'),
      supabase
        .from('positions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'checked'),
      supabase
        .from('positions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'checked')
        .gte('last_checked', todayStart),
      supabase
        .from('positions')
        .select('notes')
        .eq('status', 'excluded')
        .gte('last_checked', todayStart),
    ])

    const queue = queueRes.data ?? []
    const recent_processed = processedRes.data ?? []
    const recent_excluded = excludedRes.data ?? []
    const queue_size = queueCountRes.count ?? 0
    const checked_total = checkedCountRes.count ?? 0
    const analyzed_today = analyzedTodayRes.count ?? 0
    const excludedTodayData = excludedTodayRes.data ?? []
    const excluded_today = excludedTodayData.length

    // Categorizza esclusioni di oggi
    const exclusion_categories: Record<string, number> = {}
    for (const row of excludedTodayData) {
      if (row.notes) {
        const cat = categorizeExclusion(row.notes)
        exclusion_categories[cat] = (exclusion_categories[cat] ?? 0) + 1
      }
    }

    return NextResponse.json({
      queue,
      recent_processed,
      recent_excluded,
      queue_size,
      checked_total,
      analyzed_today,
      excluded_today,
      ratio: { checked: analyzed_today, excluded: excluded_today },
      exclusion_categories,
    })
  } catch (error) {
    console.error('[analista-activity] error:', error)
    return NextResponse.json({ error: 'Errore interno' }, { status: 500 })
  }
}
