import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// GET /api/cloud-sync/pull-desired-state?since=<ISO>&limit=<n>
//
// Reverse del push: il container chiama questo endpoint per recuperare
// le intenzioni utente scritte direttamente dal browser su Supabase
// mentre il container era fermo o senza network. Caso d'uso primario:
// l'utente clicca "Scrivi CV" via web (in cloud-mode il bottone scrive
// solo su Supabase via `/api/positions/[legacyId]/write-request`), poi
// il container riavvia e qui legge i flag `write_requested` aggiornati.
//
// Scope: `positions.write_requested[_at]` (V6, mig 024) +
// `positions.geocode_requested[_at]` (V8, mig 027). Pattern desired-state
// per-row, estendibile a futuri flag user-driven mantenendo la stessa
// shape della response (campi opzionali, client UPDATE solo le presenti).
//
// Volume atteso: invocato al boot del team (jht team start) + opzionale
// tick nel daemon. Pull "tutto modificato in finestra" cap default 7gg
// con paginazione cursor-based (since param + has_more flag).
//
// Auth: Bearer jht_sync_ token (stesso schema di push/team-commands).
// Rate limit: 30/min/token — read-only, più alto del push (20/min).

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  const rl = await checkCloudSyncRateLimit("pull-desired-state", tokenId, 30);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  // Default lookback 7gg: prima invocazione assoluta o cursor cancellato
  // → evita full-table scan. 7gg copre downtime container realistici
  // (vacanze, restart prolungato) senza esplodere il payload.
  const since = sinceParam
    ? new Date(sinceParam)
    : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { ok: false, error: "`since` must be ISO 8601 timestamp" },
      { status: 400 },
    );
  }

  const limitRaw = parseInt(url.searchParams.get("limit") || "500", 10);
  const limit = Math.min(
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 500),
    2000,
  );

  // Filtro intenzionalmente AMPIO: tutte le righe modificate dopo `since`,
  // anche con write_requested=FALSE / geocode_requested=FALSE. Cattura sia
  // toggle-on (utente clicca via web) sia toggle-off (utente annulla via
  // web mentre container era offline). Senza il toggle-off, il container
  // manterrebbe il flag=TRUE per sempre dopo un annulla via altro device.
  //
  // Proiezione lean: solo i campi necessari al merge desired-state.
  // Volume tipico: <100 righe/boot anche su pool da 1000 positions
  // (le righe modificate sono già delta del push container→cloud).
  // Esclusione MANUALE utente (mig 041) inclusa nella proiezione: è un cambio
  // di STATO deciso dal web. Va portata alla VPS perché il team smetta di
  // lavorarci, MA in modo NARROW (solo se user_excluded_at è valorizzato): lo
  // status generico resta autoritativo lato VPS, qui sincronizziamo solo
  // l'azione-utente. Vedi handlePullDesiredState (CLI). NB: stringa select
  // LITERALE (no concat) — Supabase inferisce il tipo righe dal literal.
  const { data, error } = await admin
    .from("positions")
    .select(
      "legacy_id, write_requested, write_requested_at, geocode_requested, geocode_requested_at, recheck_requested, recheck_requested_at, salary_precise_requested, salary_precise_requested_at, status, user_excluded_reason, user_excluded_note, user_excluded_at, user_excluded_prev_status, updated_at",
    )
    .eq("user_id", userId)
    .gt("updated_at", since.toISOString())
    .order("updated_at", { ascending: true })
    .limit(limit + 1);

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/pull-desired-state",
      publicMessage: "query_failed",
    });
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  const positions = hasMore ? rows.slice(0, limit) : rows;

  // Cursor = MAX(updated_at) tra le righe restituite. Se zero righe,
  // ritorniamo `since` invariato così il client non avanza inutilmente
  // (al prossimo pull rivede la stessa finestra). Le righe sono ordinate
  // ASC per updated_at, quindi MAX = ultima.
  const cursor =
    positions.length > 0
      ? positions[positions.length - 1].updated_at
      : since.toISOString();

  // [JHT-MSG-BACKFLOW] Reply/ack scritti dall'utente sulla chat web: vanno
  // riportati alla SQLite locale, dove l'agente li legge (filtro
  // user_reply_at NOT NULL AND agent_seen_reply_at NULL nel prompt). Cursore
  // dedicato `messages_since` sui timestamp delle azioni-utente (updated_at
  // qui è inutilizzabile: il full-push VPS lo bumpa a ogni tick). Best-effort:
  // un errore qui non rompe il pull dei flag posizione.
  const msgSinceParam = url.searchParams.get("messages_since");
  const msgSince = msgSinceParam
    ? new Date(msgSinceParam)
    : new Date(Date.now() - DEFAULT_LOOKBACK_MS);
  let pendingReplies: Record<string, unknown>[] = [];
  let messagesCursor = Number.isNaN(msgSince.getTime())
    ? null
    : msgSince.toISOString();
  if (messagesCursor) {
    const iso = msgSince.toISOString();
    const { data: msgData, error: msgError } = await admin
      .from("pending_user_messages")
      .select("legacy_id, acknowledged_at, user_reply, user_reply_at")
      .eq("user_id", userId)
      .or(`user_reply_at.gt.${iso},acknowledged_at.gt.${iso}`)
      .order("legacy_id", { ascending: true })
      .limit(500);
    if (!msgError && msgData) {
      pendingReplies = msgData;
      // Confronto fra DATE (Date.parse), non fra stringhe: Postgres emette
      // `+00:00` mentre toISOString emette `Z` → il compare lessicografico
      // è inaffidabile (stessa trappola del cursore pull congelato, 15/07).
      let maxMs = Date.parse(messagesCursor);
      for (const m of msgData) {
        for (const ts of [m.user_reply_at, m.acknowledged_at]) {
          if (typeof ts !== "string") continue;
          const ms = Date.parse(ts);
          if (!Number.isNaN(ms) && ms > maxMs) {
            maxMs = ms;
            messagesCursor = ts;
          }
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    positions,
    cursor,
    has_more: hasMore,
    pending_replies: pendingReplies,
    messages_cursor: messagesCursor,
  });
}
