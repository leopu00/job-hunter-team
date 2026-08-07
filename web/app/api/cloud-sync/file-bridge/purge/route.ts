import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import {
  fileBridgeListedObjectPath,
  fileBridgeStoragePrefix,
} from "@/lib/file-bridge-storage";

export const dynamic = "force-dynamic";

const BUCKET = "file-transit";
const STORAGE_LIST_PAGE = 100;
const STORAGE_PURGE_LIMIT = 1000;

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
    .select("id")
    .eq("user_id", userId)
    .in("status", ["ready", "served"])
    .not("expires_at", "is", null)
    .lt("expires_at", nowIso)
    .limit(200);
  if (readErr) {
    return NextResponse.json(
      { ok: false, error: "purge_query_failed" },
      { status: 500 },
    );
  }

  // Enumerate only beneath the authenticated user's canonical request
  // prefixes. This also finds pre-migration objects whose final filename was
  // variable, without ever consulting the old client-writable storage_path.
  // Finish the census before deleting anything so a listing failure cannot
  // create a partial purge that is nevertheless reported as successful.
  const storage = admin.storage.from(BUCKET);
  const paths: string[] = [];
  for (const row of stale || []) {
    const prefix = fileBridgeStoragePrefix(userId, row.id);
    for (let offset = 0; ; offset += STORAGE_LIST_PAGE) {
      const { data: objects, error: listErr } = await storage.list(prefix, {
        limit: STORAGE_LIST_PAGE,
        offset,
      });
      if (listErr) {
        return NextResponse.json(
          { ok: false, error: "storage_list_failed" },
          { status: 500 },
        );
      }
      for (const object of objects || []) {
        if (!object.id) {
          return NextResponse.json(
            { ok: false, error: "storage_layout_invalid" },
            { status: 500 },
          );
        }
        try {
          paths.push(fileBridgeListedObjectPath(userId, row.id, object.name));
        } catch {
          return NextResponse.json(
            { ok: false, error: "storage_layout_invalid" },
            { status: 500 },
          );
        }
        if (paths.length > STORAGE_PURGE_LIMIT) {
          return NextResponse.json(
            { ok: false, error: "storage_purge_limit" },
            { status: 500 },
          );
        }
      }
      if ((objects || []).length < STORAGE_LIST_PAGE) break;
    }
  }
  if (paths.length > 0) {
    const { error: rmErr } = await storage.remove(paths);
    if (rmErr) {
      return NextResponse.json(
        { ok: false, error: "storage_remove_failed" },
        { status: 500 },
      );
    }
    // Storage.remove may report no provider error even when an object was not
    // removed. Re-enumerate each owned prefix before changing database state;
    // a residual object means the purge is incomplete, never successful.
    for (const row of stale || []) {
      const prefix = fileBridgeStoragePrefix(userId, row.id);
      const { data: remaining, error: verifyErr } = await storage.list(prefix, {
        limit: 1,
        offset: 0,
      });
      if (verifyErr || (remaining || []).length > 0) {
        return NextResponse.json(
          { ok: false, error: "storage_remove_incomplete" },
          { status: 500 },
        );
      }
    }
  }

  const ids = (stale || []).map((r) => r.id);
  if (ids.length > 0) {
    const { error: updateErr } = await admin
      .from("file_bridge_requests")
      .update({ status: "expired", updated_at: nowIso })
      .in("id", ids)
      .eq("user_id", userId);
    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: "purge_state_update_failed" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, purged: ids.length });
}
