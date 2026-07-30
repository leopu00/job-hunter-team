import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/team-state/auth";
import { isSupabaseConfigured } from "@/lib/workspace";
import { isDemoPositionId } from "@/lib/demo/data";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// Marca una posizione come "vista" dall'utente corrente (tabella
// position_views, mig 055). Chiamata fire-and-forget da MarkSeenAfterView
// dopo 2s di permanenza sulla pagina della posizione: il marker "nuova"
// sparisce cross-device. Insert-only e idempotente (PK user+position,
// ignoreDuplicates): non esiste un "ri-nuova" da API.
//
// In local-only mode (nessun Supabase configurato) risponde 204: lo stato
// resta in localStorage lato client, stesso comportamento pre-mig-055.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return new NextResponse(null, { status: 204 });
  }

  let positionId: unknown;
  try {
    ({ position_id: positionId } = await req.json());
  } catch {
    return invalidJsonBody();
  }
  // [JHT-WEB-DEMO] Posizione demo: niente riga in position_views, lo stato
  // "vista" delle demo è derivato dall'età (vedi getSeenPositionIds).
  if (typeof positionId === "string" && isDemoPositionId(positionId)) {
    return new NextResponse(null, { status: 204 });
  }
  if (typeof positionId !== "string" || !UUID_RE.test(positionId)) {
    return NextResponse.json(
      { error: "position_id deve essere un uuid" },
      { status: 400 },
    );
  }

  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { userId, supabase } = resolved.user;

  // Nel path token il client è service_role (bypassa RLS): user_id è
  // sempre esplicito, mai derivato lato DB.
  const { error } = await supabase
    .from("position_views")
    .upsert(
      { user_id: userId, position_id: positionId },
      { onConflict: "user_id,position_id", ignoreDuplicates: true },
    );
  if (error) {
    // FK violata = posizione inesistente/cancellata: per il client è
    // indifferente, niente 500 rumorosi su un fire-and-forget.
    const status = error.code === "23503" ? 404 : 500;
    return sanitizedError(error, { status, scope: "positions/seen" });
  }
  return NextResponse.json({ ok: true });
}
