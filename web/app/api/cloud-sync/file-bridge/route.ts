import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// GET /api/cloud-sync/file-bridge?status=pending
// Poller-side (VPS container) polling endpoint. Auth via jht_sync_ Bearer
// token. Ritorna le richieste di bridge file dell'utente padrone del token.
// Mirror di /api/cloud-sync/team-commands. Vedi
// docs/internal/file-bridge-on-demand-2026-06-07.md
export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth.data;

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "pending").toLowerCase();
  const validStatus = new Set([
    "pending",
    "uploading",
    "ready",
    "served",
    "error",
    "expired",
  ]);
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
    .from("file_bridge_requests")
    .select("id, file_name, status, created_at")
    .eq("user_id", userId)
    .eq("status", status)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/file-bridge",
      publicMessage: "query_failed",
    });
  }
  return NextResponse.json({ ok: true, requests: data || [] });
}
