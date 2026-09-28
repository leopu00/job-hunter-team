import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readLocalOr } from "@/lib/local-workspace";
import { fetchPostgrestRows } from "@/lib/postgrest-pages";
import {
  categorizeExclusion,
  getAnalistaActivityLocal,
} from "@/lib/local-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  // [WEB-10-DATA-ROUTES-UNGUARDED] Feed di lavoro del team: dati
  // dell'utente, non una pagina pubblica. Unico chiamante
  // `app/(protected)/team/analista`.
  const denied = await requireAuth();
  if (denied) return denied;

  // Local-only (host localhost + jobs.db presente): leggi DIRETTO dal DB
  // locale, mai Supabase → le pagine team funzionano senza login cloud
  // (direction shift "interaction planes", gap WEB-READONLY). Se il ramo
  // local fallisce (es. schema parziale), si scende al path Supabase sotto.
  const fromLocal = await readLocalOr(
    "analista/activity",
    getAnalistaActivityLocal,
  );
  if (fromLocal !== null) return NextResponse.json(fromLocal);
  try {
    const supabase = await createClient();
    const today = new Date().toISOString().slice(0, 10);

    const [
      queueRes,
      processedRes,
      excludedRes,
      countNewRes,
      countCheckedRes,
      countAnalyzedRes,
      countExcludedRes,
      excludedTodayRes,
    ] = await Promise.all([
      supabase
        .from("positions")
        .select(
          "id, title, company, location, remote_type, source, found_by, found_at, notes",
        )
        .is("deleted_at", null)
        .eq("status", "new")
        .order("id", { ascending: false })
        .limit(10),
      supabase
        .from("positions")
        .select(
          "id, title, company, location, remote_type, status, source, found_at, last_checked, notes",
        )
        .is("deleted_at", null)
        .eq("status", "checked")
        .order("last_checked", { ascending: false })
        .limit(10),
      supabase
        .from("positions")
        .select(
          "id, title, company, location, remote_type, status, source, found_at, last_checked, notes",
        )
        .is("deleted_at", null)
        .eq("status", "excluded")
        .not("last_checked", "is", null)
        .order("last_checked", { ascending: false })
        .limit(10),
      supabase
        .from("positions")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("status", "new"),
      supabase
        .from("positions")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("status", "checked"),
      supabase
        .from("positions")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("status", "checked")
        .gte("last_checked", today),
      supabase
        .from("positions")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("status", "excluded")
        .gte("last_checked", today),
      // Senza limite: le categorie contano TUTTE le escluse di oggi, anche
      // oltre il tetto di 1000 righe di PostgREST.
      fetchPostgrestRows<any>(
        supabase
          .from("positions")
          .select("notes")
          .is("deleted_at", null)
          .eq("status", "excluded")
          .gte("last_checked", today)
          .order("id", { ascending: true }),
      ),
    ]);

    const analyzedToday = countAnalyzedRes.count ?? 0;
    const excludedToday = countExcludedRes.count ?? 0;

    const exclusionCategories: Record<string, number> = {};
    for (const row of excludedTodayRes.error ? [] : excludedTodayRes.data) {
      const cat = categorizeExclusion(row.notes);
      exclusionCategories[cat] = (exclusionCategories[cat] ?? 0) + 1;
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
    });
  } catch (err) {
    console.error("[analista/activity]", err);
    return NextResponse.json({
      queue: [],
      recent_processed: [],
      recent_excluded: [],
      queue_size: 0,
      checked_total: 0,
      analyzed_today: 0,
      excluded_today: 0,
      ratio: { checked: 0, excluded: 0 },
      exclusion_categories: {},
    });
  }
}
