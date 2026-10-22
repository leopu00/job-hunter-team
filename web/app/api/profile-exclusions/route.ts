import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/team-state/auth";
import { isSupabaseConfigured } from "@/lib/workspace";
import { sanitizedError } from "@/lib/error-response";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { isProposableReason } from "@/lib/feedback-reasons";

export const dynamic = "force-dynamic";

// La decisione dell'utente sulle proposte di esclusione del profilo
// (JHT-T05, JHT-T24, mig 094): codice, stato, data. Accettata, fa abbassare il
// punteggio delle posizioni di quel tipo (il team la porta nella sua jobs.db).
//
// SCRIVERE si fa anche dal sito (decisione dell'operatore, 22/10/2026: il sito
// fa ciò che serve all'utente): è un'azione L1 della corsia delle richieste,
// una riga dell'utente sulla sua riga, senza effetto fuori. Il desktop non
// passa da qui: scrive con la sessione dell'utente dal suo ponte
// (`desktop/src/lib/web-api.ts`). Il censimento delle route di scrittura
// (`web-write-routes-census`) la elenca come `request-lane` L1.
//
// Solo la sessione dell'utente: è una sua decisione, e un token di
// dispositivo (cioè un agente, o la CLI guidata da un agente) non la prende
// al posto suo. Il filtro su user_id è esplicito e non delegato alla RLS.

const SESSION_ONLY = { error: "session_only" };
const COLUMNS = "reason, status, positions_at_decision, decided_at";

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ exclusions: [] });
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(SESSION_ONLY, { status: 403 });
  }
  const { userId, supabase } = resolved.user;
  const { data, error } = await supabase
    .from("profile_exclusions")
    .select(COLUMNS)
    .eq("user_id", userId);
  if (error) {
    return sanitizedError(error, { status: 500, scope: "profile-exclusions" });
  }
  return NextResponse.json({ exclusions: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "cloud_unavailable" }, { status: 503 });
  }
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(SESSION_ONLY, { status: 403 });
  }
  const { userId, supabase } = resolved.user;

  let body: { reason?: unknown; status?: unknown; positions?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!isProposableReason(reason)) {
    return NextResponse.json({ error: "reason_invalid" }, { status: 400 });
  }
  if (body.status !== "accepted" && body.status !== "dismissed") {
    return NextResponse.json({ error: "status_invalid" }, { status: 400 });
  }
  const positions =
    typeof body.positions === "number" &&
    Number.isInteger(body.positions) &&
    body.positions >= 0 &&
    body.positions <= 100_000
      ? body.positions
      : 0;

  const { data, error } = await supabase
    .from("profile_exclusions")
    .upsert(
      {
        user_id: userId,
        reason,
        status: body.status,
        positions_at_decision: positions,
        decided_at: new Date().toISOString(),
      },
      { onConflict: "user_id,reason" },
    )
    .select(COLUMNS)
    .single();
  if (error) {
    return sanitizedError(error, { status: 500, scope: "profile-exclusions" });
  }
  return NextResponse.json({ exclusion: data });
}
