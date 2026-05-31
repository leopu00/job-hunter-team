import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";

export const dynamic = "force-dynamic";

// GET /api/cloud-sync/team-commands?status=pending
// Subscriber-side polling endpoint per VPS container. Auth via
// jht_sync_ Bearer token (cloud_sync_tokens). Ritorna comandi
// pending dell'utente padrone del token, ordinati per requested_at.
//
// Pensato come fallback robusto a Supabase Realtime WS: il VPS non
// ha le credenziali user Supabase per autenticarsi al WS (cloud.json
// conserva solo jht_sync_ token + user_id, non refresh_token), quindi
// fa long-poll qui ogni N secondi. Le INSERT lato web restano via
// /api/team/command (con auth user normale), mentre questa GET e
// la PATCH gemella usano jht_sync_ (admin lookup user_id).

export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth.data;

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "pending").toLowerCase();
  const validStatus = new Set(["pending", "running", "done", "error"]);
  if (!validStatus.has(status)) {
    return NextResponse.json(
      { ok: false, error: "invalid status filter" },
      { status: 400 },
    );
  }
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10) || 20,
    100,
  );

  const { data, error } = await admin
    .from("team_commands")
    .select("id, action, payload, requested_at, status")
    .eq("user_id", userId)
    .eq("status", status)
    .order("requested_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { ok: false, error: `query failed: ${error.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, commands: data || [] });
}
