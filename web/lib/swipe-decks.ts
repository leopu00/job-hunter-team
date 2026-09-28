import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPostgrestRows } from "@/lib/postgrest-pages";
import { salaryPreference } from "@/lib/salary-source";
import type { PositionWithScore } from "@/lib/types";

// I due mazzi di /swipe letti da Supabase, con il client che si ha: la
// sessione dell'utente (RLS) nel web cloud e nella desktop. Estratti da
// lib/queries.ts, che li usa per il suo ramo cloud dopo demo e workspace
// locale; qui niente Next, così la desktop li importa senza il server.

type SwipeClient = Pick<SupabaseClient, "from">;

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type SwipeReviewedRow = {
  position: PositionWithScore;
  action: string;
  fb_score: number | null;
};

export async function getLatestFeedbackByLegacyId(
  supabase: SwipeClient,
): Promise<Map<string, { action: string; score: number | null }>> {
  // Tutto il registro, a pagine: con una risposta sola PostgREST ne dà 1000
  // e le posizioni giudicate prima tornerebbero nel mazzo da giudicare.
  // Ordine chiuso da posizione e azione, così le pagine non si sovrappongono.
  // Non da `id`: la colonna non è nella ricevuta dello schema live di
  // position_feedback (089.web.columns.position_feedback), e due eventi
  // della stessa posizione con la stessa azione nello stesso microsecondo
  // sono la stessa cosa per chi legge.
  const { data, error } = await fetchPostgrestRows<any>(
    supabase
      .from("position_feedback")
      .select("position_legacy_id, action, score, created_at")
      .in("action", ["like", "dislike", "hide", "star", "clear"])
      .order("created_at", { ascending: false })
      .order("position_legacy_id", { ascending: true })
      .order("action", { ascending: true }),
  );
  const map = new Map<string, { action: string; score: number | null }>();
  if (error) return map;
  // 'clear' (mig 059) più recente = voto ritirato: la posizione non deve
  // ripescare gli eventi più vecchi → si marca e si salta.
  const cleared = new Set<string>();
  for (const r of data as any[]) {
    const k = String(r.position_legacy_id);
    if (map.has(k) || cleared.has(k)) continue;
    if (r.action === "clear") cleared.add(k);
    else map.set(k, { action: r.action, score: r.score ?? null });
  }
  return map;
}

export async function getSwipeDecksCloud(
  supabase: SwipeClient,
  limit = 1000,
): Promise<{
  pending: PositionWithScore[];
  reviewed: SwipeReviewedRow[];
}> {
  // Prima il registro dei giudizi, che dice quale mazzo riempie ogni riga;
  // poi le posizioni a pagine, finché i due mazzi non sono pieni. `limit`
  // vale per ciascun mazzo, non per le righe lette: con un tetto sulle righe
  // le prime `limit` per found_at (escluse comprese) riempivano il risultato
  // e le giudicate più recenti non entravano mai; senza nessun tetto, ogni
  // resa della pagina scaricava tutte le posizioni.
  const feedback = await getLatestFeedbackByLegacyId(supabase);
  const decks = { pending: 0, reviewed: 0 };
  let counted = 0;
  const bothFull = (rows: any[]) => {
    for (; counted < rows.length; counted++) {
      const p = rows[counted];
      if (p.legacy_id != null && feedback.has(String(p.legacy_id)))
        decks.reviewed++;
      else if (p.status === "scored" || p.status === "ready") decks.pending++;
    }
    return decks.pending >= limit && decks.reviewed >= limit;
  };
  const { data, error } = await fetchPostgrestRows<any>(
    supabase
      .from("positions")
      .select(
        // NIENTE jd_summary/jd_text: senza cap il mazzo supera le 900 card e
        // i testi inline affossavano SSR/hydration — la card li scarica
        // on-demand da /api/positions/[legacyId]/summary.
        "id, legacy_id, title, company, location, remote_type, salary_declared_min, salary_declared_max, salary_declared_currency, salary_estimated_min, salary_estimated_max, salary_estimated_currency, url, source, found_at, status, score, role_family, loc_country, loc_city, scores ( total_score )",
      )
      // 'excluded' incluso: le posizioni giudicate "non interessante"
      // devono restare visitabili nel mazzo reviewed. Non si filtrano lato
      // server: servono solo quelle con un feedback, e l'elenco dei
      // legacy_id giudicati non sta in un URL.
      .in("status", ["scored", "ready", "excluded"])
      .is("deleted_at", null)
      // Uno score cancellato non dà il punteggio alla card.
      .is("scores.deleted_at", null)
      .order("found_at", { ascending: true })
      .order("id", { ascending: true }),
    { enough: bothFull },
  );
  if (error) return { pending: [], reviewed: [] };

  const mapRow = (p: any): PositionWithScore => {
    const sc = firstRelated<any>(p.scores);
    // Dichiarato prima della stima (O-32): sullo swipe l'utente decide in un
    // gesto, quindi il numero sbagliato lì costa ancora meno attenzione.
    const salary = salaryPreference(p);
    return {
      ...p,
      score: sc?.total_score ?? undefined,
      scores: undefined,
      salary_min: salary.min,
      salary_max: salary.max,
      salary_currency: salary.currency,
    } as PositionWithScore;
  };

  const pending: PositionWithScore[] = [];
  const reviewed: SwipeReviewedRow[] = [];
  for (const p of data as any[]) {
    const fb = p.legacy_id != null ? feedback.get(String(p.legacy_id)) : null;
    if (fb) {
      if (reviewed.length < limit)
        reviewed.push({
          position: mapRow(p),
          action: fb.action,
          fb_score: fb.score,
        });
    } else if (
      (p.status === "scored" || p.status === "ready") &&
      pending.length < limit
    ) {
      pending.push(mapRow(p));
    }
    if (pending.length >= limit && reviewed.length >= limit) break;
  }
  return { pending, reviewed };
}
