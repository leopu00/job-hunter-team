import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// Round-trip ticket cloud↔VPS ([JHT-DATA-SYNC] fase 2). Chiude il follow-up
// dichiarato in mig 043: prima la feature girava solo sul path locale.
//
//   GET  /api/cloud-sync/tickets?since=<ISO>&limit=<n>
//        → il container PULLA i ticket 'open' creati dall'utente sul web cloud
//          (per importarli in SQLite e farli vedere al Capitano via C-15).
//   POST /api/cloud-sync/tickets
//        → il container PUSHA gli aggiornamenti del team: risoluzioni
//          (assigned/resolved + response_text) sui ticket già su cloud, e
//          INSERT dei ticket nati in locale (ritorna l'id per la correlazione).
//
// Correlazione: il cloud `id` (BIGINT identity, mig 043) è canonico; il locale
// tiene `position_tickets.cloud_id`. Pull → INSERT locale con cloud_id valorizzato.
// Push update → UPDATE cloud WHERE id=cloud_id. Push insert → ritorna l'id che
// il CLI scrive in locale. position_legacy_id (int stabile) == positions.legacy_id.
//
// Auth: Bearer jht_sync_ token (come push/pull-desired-state). Service-role →
// RLS bypassata → SEMPRE `.eq("user_id", userId)` esplicito su ogni query.

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_STATUS = new Set(["open", "assigned", "resolved"]);
const RESCORE_KIND = "rescore";

interface TicketPushIn {
  // id locale SQLite — eco per la correlazione lato CLI (id_map sugli INSERT).
  local_id: number;
  // id cloud (mig 043). Presente → UPDATE; assente/null → INSERT nuovo.
  cloud_id?: number | null;
  position_legacy_id: number;
  request_text?: string | null;
  kind?: string | null;
  status: string;
  assigned_agent?: string | null;
  response_text?: string | null;
  created_at?: string | null;
  assigned_at?: string | null;
  resolved_at?: string | null;
}

// ── GET: pull dei ticket 'open' creati dall'utente sul cloud ───────────────
export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  const rl = await checkCloudSyncRateLimit("tickets-pull", tokenId, 30);
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

  // Solo status='open' = nuove richieste da importare. Dopo l'import il team
  // possiede il ciclo di vita (assigned/resolved), che NON va ri-tirato giù
  // (il container è la source-of-truth della risoluzione). Cursor su created_at.
  const { data, error } = await admin
    .from("position_tickets")
    .select("id, position_legacy_id, request_text, kind, status, created_at")
    .eq("user_id", userId)
    .eq("status", "open")
    .gt("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(limit + 1);

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/tickets",
      publicMessage: "query_failed",
    });
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  const tickets = hasMore ? rows.slice(0, limit) : rows;
  const cursor =
    tickets.length > 0
      ? tickets[tickets.length - 1].created_at
      : since.toISOString();

  return NextResponse.json({ ok: true, tickets, cursor, has_more: hasMore });
}

// ── POST: push degli aggiornamenti del team (risoluzioni + INSERT locali) ──
export async function POST(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  // Write-side: cap come il push principale. Volume reale dei ticket basso.
  const rl = await checkCloudSyncRateLimit("tickets-push", tokenId, 20);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { tickets?: TicketPushIn[] };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  const tickets = Array.isArray(body.tickets)
    ? body.tickets.slice(0, 1000)
    : [];

  let updated = 0;
  let inserted = 0;
  const idMap: Record<string, number> = {}; // local_id (string) → cloud_id

  const findActiveRescore = async (positionLegacyId: number) =>
    admin
      .from("position_tickets")
      .select("id")
      .eq("user_id", userId)
      .eq("position_legacy_id", positionLegacyId)
      .eq("kind", RESCORE_KIND)
      .in("status", ["open", "assigned"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  for (const t of tickets) {
    if (!t || typeof t.position_legacy_id !== "number") continue;
    const status = ALLOWED_STATUS.has(t.status) ? t.status : "open";

    if (typeof t.cloud_id === "number") {
      // UPDATE risoluzione/assegnazione. Filtro user_id obbligatorio
      // (service-role → no RLS): impedisce il takeover di ticket altrui.
      const { error } = await admin
        .from("position_tickets")
        .update({
          status,
          assigned_agent: t.assigned_agent ?? null,
          response_text: t.response_text ?? null,
          assigned_at: t.assigned_at ?? null,
          resolved_at: t.resolved_at ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", t.cloud_id)
        .eq("user_id", userId);
      if (!error) updated++;
    } else {
      // INSERT di un ticket nato in locale → ritorna l'id per la correlazione.
      if (typeof t.local_id !== "number" || !t.request_text) continue;
      if (t.kind === RESCORE_KIND) {
        // Una richiesta equivalente può essere nata sul web mentre il box era
        // offline. Correlala all'identità cloud esistente: riprovare l'INSERT
        // a ogni tick lascerebbe il ticket locale senza cloud_id per sempre.
        const { data: active } = await findActiveRescore(t.position_legacy_id);
        if (active) {
          idMap[String(t.local_id)] = active.id as number;
          continue;
        }
      }
      const { data, error } = await admin
        .from("position_tickets")
        .insert({
          user_id: userId,
          position_legacy_id: t.position_legacy_id,
          request_text: t.request_text,
          kind: t.kind ?? "custom",
          status,
          assigned_agent: t.assigned_agent ?? null,
          response_text: t.response_text ?? null,
          ...(t.created_at ? { created_at: t.created_at } : {}),
          assigned_at: t.assigned_at ?? null,
          resolved_at: t.resolved_at ?? null,
        })
        .select("id")
        .single();
      if (!error && data) {
        idMap[String(t.local_id)] = data.id as number;
        inserted++;
      } else if (t.kind === RESCORE_KIND && error?.code === "23505") {
        // Race dopo il pre-check: l'indice ha scelto il vincitore, rileggilo.
        const { data: active } = await findActiveRescore(t.position_legacy_id);
        if (active) idMap[String(t.local_id)] = active.id as number;
      }
    }
  }

  return NextResponse.json({ ok: true, updated, inserted, id_map: idMap });
}
