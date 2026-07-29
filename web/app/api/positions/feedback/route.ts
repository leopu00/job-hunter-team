import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/team-state/auth";
import { isSupabaseConfigured } from "@/lib/workspace";

export const dynamic = "force-dynamic";

// Lettura in blocco del giudizio dell'utente su TUTTE le sue posizioni.
//
// Perché esiste, visto che c'è già GET /api/positions/[legacyId]/feedback:
// quella risponde su una posizione sola, e il Mentor non guarda una
// posizione — guarda insiemi. Contare quante volte l'utente ha scritto
// "troppo senior" costava N chiamate HTTP (una per annuncio) e restava
// quindi una cosa che nessuno faceva: i motivi scritti a mano, il dato più
// ricco che l'utente produce, morivano nel cloud. Qui è una chiamata sola.
//
// Read-only e user-scoped: nessuna scrittura, nessun dato di altri utenti.
// Sul path token il client Supabase è service_role e BYPASSA la RLS, quindi
// il filtro su user_id è esplicito e non delegato al DB (stessa regola del
// resto delle route agent-facing).
//
// In local-only mode (nessun Supabase configurato) `position_feedback` non
// esiste: si risponde 200 con lista vuota, così il chiamante non deve
// distinguere "nessun feedback" da "niente cloud" per continuare.

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ feedback: [] });
  }

  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { userId, supabase } = resolved.user;

  // days=0 → nessun taglio temporale (storia intera, sempre sotto `limit`).
  const days = clampInt(
    req.nextUrl.searchParams.get("days"),
    DEFAULT_DAYS,
    0,
    MAX_DAYS,
  );
  const limit = clampInt(
    req.nextUrl.searchParams.get("limit"),
    DEFAULT_LIMIT,
    1,
    MAX_LIMIT,
  );

  // I filtri vanno prima di order/limit: dopo il transform builder `.gte`
  // non esiste più.
  let filter = supabase
    .from("position_feedback")
    .select(
      "position_legacy_id, action, reason, comment, score, direction, created_at",
    )
    .eq("user_id", userId);

  if (days > 0) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    filter = filter.gte("created_at", since);
  }

  const { data, error } = await filter
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ feedback: data ?? [], days, limit });
}
