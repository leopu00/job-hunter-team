import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

  const [foundTodayRes, queueRes, recentRes, excludedTodayRes, totalNewRes] = await Promise.all([
    // Trovate oggi
    supabase
      .from('positions')
      .select('id', { count: 'exact', head: true })
      .gte('found_at', todayISO),
    // Coda: status=new (in attesa di analisi), ultime 10
    supabase
      .from('positions')
      .select('id, title, company, location, remote_type, found_at, found_by')
      .eq('status', 'new')
      .order('found_at', { ascending: false })
      .limit(10),
    // Feed: ultime 10 trovate (qualsiasi status != excluded)
    supabase
      .from('positions')
      .select('id, title, company, location, remote_type, found_at, found_by, status')
      .not('status', 'eq', 'excluded')
      .order('found_at', { ascending: false })
      .limit(10),
    // Escluse oggi
    supabase
      .from('positions')
      .select('id, title, company, location, remote_type, found_at, notes')
      .eq('status', 'excluded')
      .gte('found_at', todayISO)
      .order('found_at', { ascending: false })
      .limit(10),
    // Totale in status=new
    supabase
      .from('positions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new'),
  ])

  return NextResponse.json({
    stats: {
      found_today: foundTodayRes.count ?? 0,
      total_new: totalNewRes.count ?? 0,
    },
    queue: (queueRes.data as any[] ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      company: p.company,
      location: p.location,
      remote_type: p.remote_type,
      found_at: p.found_at,
      found_by: p.found_by,
    })),
    recent: (recentRes.data as any[] ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      company: p.company,
      location: p.location,
      remote_type: p.remote_type,
      found_at: p.found_at,
      found_by: p.found_by,
      status: p.status,
    })),
    excluded_today: (excludedTodayRes.data as any[] ?? []).map((p: any) => ({
      id: p.id,
      title: p.title,
      company: p.company,
      location: p.location,
      remote_type: p.remote_type,
      found_at: p.found_at,
      notes: p.notes,
    })),
  })
}
