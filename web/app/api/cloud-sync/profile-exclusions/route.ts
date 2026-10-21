import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// GET /api/cloud-sync/profile-exclusions
//
// Le decisioni dell'utente sulle proposte di esclusione del profilo (JHT-T24):
// il team le porta nella sua jobs.db, dove diventano la penalità sul punteggio.
// Ritorna SOLO codice, stato e data (mai testo dell'utente: la tabella non ne ha).
// Sola lettura: le decisioni le scrive l'utente dalla sua sessione
// (/api/profile-exclusions), non un token di dispositivo.
//
// Auth: Bearer jht_sync_ token, filtro user_id esplicito. Rate limit 30/min/token.

export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  const rl = await checkCloudSyncRateLimit("profile-exclusions", tokenId, 30);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { data, error } = await admin
    .from("profile_exclusions")
    .select("reason, status, decided_at")
    .eq("user_id", userId);
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/profile-exclusions",
      publicMessage: "query_failed",
    });
  }
  return NextResponse.json({ ok: true, exclusions: data ?? [] });
}
