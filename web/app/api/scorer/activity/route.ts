import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readLocalOr } from "@/lib/local-workspace";
import { fetchPostgrestRows } from "@/lib/postgrest-pages";
import { getScorerActivityLocal } from "@/lib/local-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  // [WEB-10-DATA-ROUTES-UNGUARDED] Feed di lavoro del team: dati
  // dell'utente, non una pagina pubblica. Unico chiamante
  // `app/(protected)/team/scorer`.
  const denied = await requireAuth();
  if (denied) return denied;

  // Local-only (host localhost + jobs.db): leggi dal DB locale, mai Supabase.
  const fromLocal = await readLocalOr(
    "scorer/activity",
    getScorerActivityLocal,
  );
  if (fromLocal !== null) return NextResponse.json(fromLocal);
  try {
    const supabase = await createClient();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const [
      queueRes,
      queueCountRes,
      recentScoredRes,
      recentExcludedRes,
      totalScoredRes,
      todayScoredRes,
    ] = await Promise.all([
      // Coda: status=checked, ultime 10
      supabase
        .from("positions")
        .select("id, title, company, location, remote_type, found_at, notes")
        .is("deleted_at", null)
        .eq("status", "checked")
        .order("found_at", { ascending: false })
        .limit(10),
      // Conteggio coda
      supabase
        .from("positions")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("status", "checked"),
      // Ultime 10 scored (score >= 40)
      supabase
        .from("scores")
        .select(
          "position_id, total_score, scored_at, scored_by, positions(title, company, location, remote_type)",
        )
        .is("deleted_at", null)
        .gte("total_score", 40)
        .order("scored_at", { ascending: false })
        .limit(10),
      // Ultime 10 escluse dallo scorer (score < 40)
      supabase
        .from("scores")
        .select(
          "position_id, total_score, scored_at, scored_by, positions(title, company, location, remote_type)",
        )
        .is("deleted_at", null)
        .lt("total_score", 40)
        .order("scored_at", { ascending: false })
        .limit(10),
      // Totale scored
      supabase
        .from("scores")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
      // Scored oggi: tutte, anche oltre il tetto di 1000 righe di PostgREST
      fetchPostgrestRows<any>(
        supabase
          .from("scores")
          .select("total_score")
          .is("deleted_at", null)
          .gte("scored_at", todayISO)
          .order("id", { ascending: true }),
      ),
    ]);

    const todayScores = (todayScoredRes.error ? [] : todayScoredRes.data).map(
      (s: any) => s.total_score as number,
    );
    const scoredToday = todayScores.length;
    const excludedToday = todayScores.filter((s: number) => s < 40).length;
    const avgToday =
      scoredToday > 0
        ? +(
            todayScores.reduce((a: number, b: number) => a + b, 0) / scoredToday
          ).toFixed(1)
        : null;

    const mapScore = (s: any) => ({
      id: s.position_id,
      title: (s.positions as any)?.title ?? "—",
      company: (s.positions as any)?.company ?? "—",
      location: (s.positions as any)?.location ?? "",
      remote_type: (s.positions as any)?.remote_type ?? "",
      total_score: s.total_score,
      scored_at: s.scored_at,
      scored_by: s.scored_by,
    });

    return NextResponse.json({
      stats: {
        queue_size: queueCountRes.count ?? 0,
        scored_total: totalScoredRes.count ?? 0,
        scored_today: scoredToday,
        excluded_today: excludedToday,
        avg_score_today: avgToday,
      },
      queue: ((queueRes.data as any[]) ?? []).map((p: any) => ({
        id: p.id,
        title: p.title,
        company: p.company,
        location: p.location,
        remote_type: p.remote_type,
        last_checked: p.found_at,
        notes: p.notes ?? "",
      })),
      recent_scored: (recentScoredRes.data ?? []).map(mapScore),
      recent_excluded: (recentExcludedRes.data ?? []).map(mapScore),
    });
  } catch (err) {
    console.error("[scorer/activity]", err);
    return NextResponse.json({
      stats: {
        queue_size: 0,
        scored_total: 0,
        scored_today: 0,
        excluded_today: 0,
        avg_score_today: null,
      },
      queue: [],
      recent_scored: [],
      recent_excluded: [],
    });
  }
}
