import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// Round-trip bacheca (team_directives) cloud↔VPS. Come i ticket (mig 043/route
// cloud-sync/tickets), ma per le DIRETTIVE permanenti dell'utente (strategia,
// modalità mantenimento, ...). Doppio verso:
//
//   GET  /api/cloud-sync/team-directives?since=<ISO>&limit=<n>
//        → il container PULLA le direttive create/modificate dall'utente sul web
//          (qualsiasi status), per aggiornare SQLite; il Capitano le legge a ogni
//          riavvio (team_directives.py active). Cursor su updated_at (non solo le
//          nuove: anche edit e archiviazioni devono propagarsi al VPS).
//   POST /api/cloud-sync/team-directives
//        → il container PUSHA le direttive nate/modificate in locale (via chat):
//          UPDATE per cloud_id, INSERT per cloud_id NULL (ritorna l'id_map).
//
// Correlazione: cloud `id` (BIGINT identity, mig 054) canonico; il locale tiene
// team_directives.cloud_id. Auth: Bearer jht_sync_ token. Service-role → RLS
// bypassata → SEMPRE `.eq("user_id", userId)` esplicito su ogni query.

const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // le direttive vivono a lungo
const ALLOWED_STATUS = new Set(["active", "archived"]);
const ALLOWED_KIND = new Set(["order", "strategy", "formation", "note"]);

interface DirectivePushIn {
  // id locale SQLite — eco per la correlazione lato CLI (id_map sugli INSERT).
  local_id: number;
  // id cloud (mig 054). Presente → UPDATE; assente/null → INSERT nuovo.
  cloud_id?: number | null;
  body?: string | null;
  kind?: string | null;
  status: string;
  sort_order?: number | null;
  created_by?: string | null;
  created_at?: string | null;
  archived_at?: string | null;
}

// ── GET: pull delle direttive create/modificate dall'utente sul cloud ──────
export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  const rl = await checkCloudSyncRateLimit("directives-pull", tokenId, 30);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { ok: false, error: "`since` must be ISO 8601 timestamp" },
      { status: 400 },
    );
  }

  const limitRaw = parseInt(url.searchParams.get("limit") || "200", 10);
  const limit = Math.min(
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 200),
    1000,
  );

  // Tutti gli status (active + archived) cambiati dopo il cursor: così un edit o
  // un'archiviazione fatta dalla dashboard arriva al VPS. Cursor su updated_at.
  const { data, error } = await admin
    .from("team_directives")
    .select(
      "id, body, kind, status, sort_order, created_by, created_at, updated_at, archived_at",
    )
    .eq("user_id", userId)
    .gt("updated_at", since.toISOString())
    .order("updated_at", { ascending: true })
    .limit(limit + 1);

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/team-directives",
      publicMessage: "query_failed",
    });
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  const directives = hasMore ? rows.slice(0, limit) : rows;
  const cursor =
    directives.length > 0
      ? directives[directives.length - 1].updated_at
      : since.toISOString();

  return NextResponse.json({ ok: true, directives, cursor, has_more: hasMore });
}

// ── POST: push delle direttive nate/modificate in locale (via chat) ────────
export async function POST(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  const rl = await checkCloudSyncRateLimit("directives-push", tokenId, 20);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { directives?: DirectivePushIn[] };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  const directives = Array.isArray(body.directives)
    ? body.directives.slice(0, 1000)
    : [];

  let updated = 0;
  let inserted = 0;
  const idMap: Record<string, number> = {}; // local_id (string) → cloud_id

  for (const d of directives) {
    if (!d) continue;
    const status = ALLOWED_STATUS.has(d.status) ? d.status : "active";
    const kind = d.kind && ALLOWED_KIND.has(d.kind) ? d.kind : "order";

    if (typeof d.cloud_id === "number") {
      // UPDATE (edit/archiviazione dal VPS). Filtro user_id obbligatorio
      // (service-role → no RLS): impedisce il takeover di direttive altrui.
      const patch: Record<string, unknown> = {
        status,
        kind,
        updated_at: new Date().toISOString(),
        archived_at: d.archived_at ?? null,
      };
      if (typeof d.body === "string") patch.body = d.body;
      if (typeof d.sort_order === "number") patch.sort_order = d.sort_order;
      const { error } = await admin
        .from("team_directives")
        .update(patch)
        .eq("id", d.cloud_id)
        .eq("user_id", userId);
      if (!error) updated++;
    } else {
      // INSERT di una direttiva nata in locale → ritorna l'id per la correlazione.
      if (typeof d.local_id !== "number" || !d.body) continue;
      const { data, error } = await admin
        .from("team_directives")
        .insert({
          user_id: userId,
          body: d.body,
          kind,
          status,
          sort_order: typeof d.sort_order === "number" ? d.sort_order : 0,
          created_by: d.created_by ?? "user",
          ...(d.created_at ? { created_at: d.created_at } : {}),
          archived_at: d.archived_at ?? null,
        })
        .select("id")
        .single();
      if (!error && data) {
        idMap[String(d.local_id)] = data.id as number;
        inserted++;
      }
    }
  }

  return NextResponse.json({ ok: true, updated, inserted, id_map: idMap });
}
