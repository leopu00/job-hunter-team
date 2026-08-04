import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function categorizeExclusion(notes: string | null): string {
  const n = (notes || '').toLowerCase()
  const m = n.match(/esclus[ao]:\s*\[(\w+)\]/i)
  if (m) return m[1].toUpperCase()
  if (/link scaduto|link morto|404|redirect|lavoro occupato|pagina rimossa|url morto/.test(n)) return 'LINK_MORTO'
  if (/score < 40|score <40|score basso/.test(n)) return 'SCORE_BASSO'
  if (/duplicat|già presente|stessa posizione/.test(n)) return 'DUPLICATA'
  if (/us-only|uk-only|americas|restrizione geografica|work authorization uk|post-brexit/.test(n)) return 'GEO'
  if (/lingua croata|tedesco obbligat|polacco|ungherese|français|dutch/.test(n)) return 'LINGUA'
  if (/senior con 5\+|5\+ anni obbligatori|seniority troppo/.test(n)) return 'SENIORITY'
  if (/senza python|no python|solo java|solo node|stack incomp/.test(n)) return 'STACK'
  if (/zero sviluppo|mismatch|ruolo non-dev|iam analyst|no coding/.test(n)) return 'RUOLO'
  if (/scam|fantasma|red flag/.test(n)) return 'SCAM'
  if (/voto critico|critic/.test(n)) return 'CRITICO'
  return 'NON_CATEGORIZZATA'
}

export async function GET() {
  try {
    const supabase = await createClient()
    const today = new Date().toISOString().slice(0, 10)

    const [queueRes, processedRes, excludedRes, countNewRes, countCheckedRes, countAnalyzedRes, countExcludedRes, excludedTodayRes] =
      await Promise.all([
        supabase
          .from('positions')
          .select('id, title, company, location, remote_type, source, found_by, found_at, notes')
          .eq('status', 'new')
          .order('id', { ascending: false })
          .limit(10),
        supabase
          .from('positions')
          .select('id, title, company, location, remote_type, status, source, found_at, last_checked, notes')
          .eq('status', 'checked')
          .order('last_checked', { ascending: false })
          .limit(10),
        supabase
          .from('positions')
          .select('id, title, company, location, remote_type, status, source, found_at, last_checked, notes')
          .eq('status', 'excluded')
          .not('last_checked', 'is', null)
          .order('last_checked', { ascending: false })
          .limit(10),
        supabase.from('positions').select('id', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('positions').select('id', { count: 'exact', head: true }).eq('status', 'checked'),
        supabase.from('positions').select('id', { count: 'exact', head: true }).eq('status', 'checked').gte('last_checked', today),
        supabase.from('positions').select('id', { count: 'exact', head: true }).eq('status', 'excluded').gte('last_checked', today),
        supabase
          .from('positions')
          .select('notes')
          .eq('status', 'excluded')
          .gte('last_checked', today),
      ])

    const analyzedToday = countAnalyzedRes.count ?? 0
    const excludedToday = countExcludedRes.count ?? 0

    const exclusionCategories: Record<string, number> = {}
    for (const row of excludedTodayRes.data ?? []) {
      const cat = categorizeExclusion(row.notes)
      exclusionCategories[cat] = (exclusionCategories[cat] ?? 0) + 1
    }

    return NextResponse.json({
      queue: queueRes.data ?? [],
      recent_processed: processedRes.data ?? [],
      recent_excluded: excludedRes.data ?? [],
      queue_size: countNewRes.count ?? 0,
      checked_total: countCheckedRes.count ?? 0,
      analyzed_today: analyzedToday,
      excluded_today: excludedToday,
      ratio: { checked: analyzedToday, excluded: excludedToday },
      exclusion_categories: exclusionCategories,
    })
  } catch (err) {
    console.error('[analista/activity]', err)
    return NextResponse.json({
      queue: [], recent_processed: [], recent_excluded: [],
      queue_size: 0, checked_total: 0, analyzed_today: 0, excluded_today: 0,
      ratio: { checked: 0, excluded: 0 }, exclusion_categories: {},
    })
  }
}
