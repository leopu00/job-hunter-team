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

function ticketBatchFailure(
  cause: unknown,
  options: {
    status: number;
    scope: string;
    publicMessage: string;
    failedLocalId: number | null;
    updated: number;
    inserted: number;
    idMap: Record<string, number>;
  },
) {
  // Il dettaglio resta nei log server, mentre al client tornano anche gli ACK
  // già confermati. Il CLI deve poter correlare un INSERT riuscito prima che
  // una riga successiva fallisca; senza id_map il retry lo reinserirebbe.
  console.error(`[${options.scope}] ${options.status}`, cause);
  return NextResponse.json(
    {
      ok: false,
      error: options.publicMessage,
      failed_local_id: options.failedLocalId,
      updated: options.updated,
      inserted: options.inserted,
      id_map: options.idMap,
    },
    { status: options.status },
  );
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

  const fail = (
    cause: unknown,
    status: number,
    scope: string,
    publicMessage: string,
    failedLocalId: number | null,
  ) =>
    ticketBatchFailure(cause, {
      status,
      scope,
      publicMessage,
      failedLocalId,
      updated,
      inserted,
      idMap,
    });

  for (const t of tickets) {
    if (
      !t ||
      !Number.isInteger(t.local_id) ||
      !Number.isInteger(t.position_legacy_id)
    ) {
      return fail(
        new Error("invalid ticket identity in push payload"),
        400,
        "cloud-sync/tickets-payload",
        "invalid_ticket_payload",
        Number.isInteger(t?.local_id) ? t.local_id : null,
      );
    }
    if (!ALLOWED_STATUS.has(t.status)) {
      return fail(
        new Error("invalid ticket status in push payload"),
        400,
        "cloud-sync/tickets-payload",
        "invalid_ticket_payload",
        t.local_id,
      );
    }
    const status = t.status;

    if (Number.isInteger(t.cloud_id)) {
      // UPDATE risoluzione/assegnazione. Filtro user_id obbligatorio
      // (service-role → no RLS): impedisce il takeover di ticket altrui.
      const { data: updatedTicket, error } = await admin
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
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();
      if (error) {
        // Il client avanza push_since soltanto su HTTP 2xx. Un 200 qui
        // trasformerebbe un errore transitorio in una risoluzione persa per
        // sempre: il ticket locale non verrebbe più inviato.
        return fail(
          error,
          500,
          "cloud-sync/tickets-update",
          "ticket_update_failed",
          t.local_id,
        );
      }
      if (!updatedTicket) {
        // Supabase non considera errore un UPDATE che non trova righe. Anche
        // quello non è un effetto confermato (cloud_id errato/riga rimossa).
        return fail(
          new Error("ticket update matched no row"),
          409,
          "cloud-sync/tickets-update",
          "ticket_update_not_applied",
          t.local_id,
        );
      }
      updated++;
    } else {
      // INSERT di un ticket nato in locale → ritorna l'id per la correlazione.
      if (!t.request_text) {
        return fail(
          new Error("ticket insert has no request text"),
          400,
          "cloud-sync/tickets-payload",
          "invalid_ticket_payload",
          t.local_id,
        );
      }
      // UUID parent resolution + INSERT/dedup are a single tenant-bound
      // transaction. The route never writes the relationship directly.
      const { data, error } = await admin.rpc("sync_create_position_ticket", {
        p_user_id: userId,
        p_position_legacy_id: t.position_legacy_id,
        p_request_text: t.request_text,
        p_kind: t.kind ?? "custom",
        p_status: status,
        p_assigned_agent: t.assigned_agent ?? null,
        p_response_text: t.response_text ?? null,
        p_created_at: t.created_at ?? null,
        p_assigned_at: t.assigned_at ?? null,
        p_resolved_at: t.resolved_at ?? null,
      });
      const receipt = data as Record<string, unknown> | null;
      if (
        !error &&
        receipt &&
        Number.isInteger(receipt.id) &&
        typeof receipt.deduplicated === "boolean"
      ) {
        idMap[String(t.local_id)] = receipt.id as number;
        if (!receipt.deduplicated) inserted++;
      } else {
        return fail(
          error ?? new Error("ticket RPC returned invalid receipt"),
          500,
          "cloud-sync/tickets-insert",
          "ticket_insert_failed",
          t.local_id,
        );
      }
    }
  }

  return NextResponse.json({ ok: true, updated, inserted, id_map: idMap });
}
