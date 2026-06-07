import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";

export const dynamic = "force-dynamic";

const BUCKET = "file-transit";

// POST /api/cloud-sync/file-bridge/purge
// Poller-side (VPS, jht_sync_ Bearer). Effimero: elimina dal bucket gli
// oggetti delle richieste scadute (expires_at < now()) e marca le righe
// 'expired'. La VPS non ha creds Storage, quindi il purge lo esegue il web
// (service-role). Vedi docs/internal/file-bridge-on-demand-2026-06-07.md
export async function POST(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth.data;

  const nowIso = new Date().toISOString();

  // Candidate alla pulizia: già servite/pronte e scadute.
  const { data: stale, error: readErr } = await admin
    .from("file_bridge_requests")
    .select("id, storage_path")
    .eq("user_id", userId)
    .in("status", ["ready", "served"])
    .not("expires_at", "is", null)
    .lt("expires_at", nowIso)
    .limit(200);
  if (readErr) {
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }

  const paths = (stale || []).map((r) => r.storage_path).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
    if (rmErr) {
      return NextResponse.json(
        { ok: false, error: `storage remove failed: ${rmErr.message}` },
        { status: 500 },
      );
    }
  }

  const ids = (stale || []).map((r) => r.id);
  if (ids.length > 0) {
    await admin
      .from("file_bridge_requests")
      .update({ status: "expired", updated_at: nowIso })
      .in("id", ids)
      .eq("user_id", userId);
  }

  return NextResponse.json({ ok: true, purged: ids.length });
}
