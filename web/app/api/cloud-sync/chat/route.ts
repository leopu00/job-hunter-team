import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";

export const dynamic = "force-dynamic";

// [JHT-CHAT-UNIFY] Il verso web→agente della chat, sul canale del BOX.
//
// ── Perché questa route esiste ─────────────────────────────────────────────
// Il verso agente→web funziona da sempre perché passa di qui accanto
// (`/api/cloud-sync/push`, Bearer token del box): consegna misurata in ~1s.
// Il verso opposto invece esisteva SOLO sul lettore Supabase-diretto del
// daemon (`readUndeliveredUserChat`/`markUserChatDelivered` in
// cli/src/lib/supabase-direct.js), che è opt-in via `JHT_SUPABASE_DIRECT=1` e
// sul fleet è spento — "default OFF → nessun cambio sul fleet", vedi
// docs/internal/architecture/daemon-sync-redesign.md. Su un box in
// configurazione standard il turno scritto dal web restava su Supabase e non
// veniva ritirato MAI: la chat moriva in silenzio, senza un errore.
//
// Qui la corsia chat ottiene lo stesso canale che il push già usa con
// successo, con la STESSA autenticazione (nessun secondo schema):
//   GET  → i turni `author='user'` non ancora consegnati al pane dell'agente;
//   POST → li marca consegnati e chiude il rendezvous (`chat_delivered_at`).
//
// NB: `requireLocalWrite()` (web read-only) NON si applica qui. Quel gate
// protegge le scritture del BROWSER; questo è il canale del box, autenticato
// col suo token di sync — esattamente come il push.
//
// Auth: Bearer jht_sync_ token (come push/tickets/pull-desired-state).
// Service-role → RLS bypassata → SEMPRE `.eq("user_id", userId)` esplicito.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// Tetto agli id per ack: la coda reale è di pochi turni (il box ne consegna 5
// per tick). Il cap è solo per non lasciare aperta una IN() illimitata.
const MAX_ACK_IDS = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET: i turni dell'utente che il box non ha ancora consegnato ───────────
export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  // Il box chiama solo quando `team_state.chat_requested_at` dice che c'è
  // qualcosa da ritirare (giro veloce ~5s): a chat ferma questa route non
  // viene invocata. Il cap copre il caso patologico del pane occupato, dove
  // il rendezvous resta aperto e il giro ritenta ogni 5s (12/min).
  const rl = await checkCloudSyncRateLimit("chat-pull", tokenId, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const limitRaw = parseInt(
    new URL(req.url).searchParams.get("limit") || String(DEFAULT_LIMIT),
    10,
  );
  const limit = Math.min(
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  // Stessa query del lettore diretto (supabase-direct.js): righe NATIVE del
  // cloud (legacy_id negativo, mig 060) mai viste dalla SQLite del box.
  // L'ordine è cronologico perché la conversazione arrivi nell'ordine in cui
  // è stata scritta. Indice parziale dedicato: idx_..._undelivered_user.
  const { data, error } = await admin
    .from("pending_user_messages")
    .select("id, legacy_id, agent, body, created_at")
    .eq("user_id", userId)
    .eq("author", "user")
    .is("delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { ok: false, error: `query failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, messages: data || [] });
}

// ── POST: ack della consegna + chiusura del rendezvous ────────────────────
export async function POST(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin, tokenId } = auth.data;

  const rl = await checkCloudSyncRateLimit("chat-ack", tokenId, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { delivered_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "body JSON non valido" },
      { status: 400 },
    );
  }

  // Solo UUID ben formati: gli id arrivano dal GET qui sopra, e un valore
  // spurio in una IN() è un errore PostgREST che farebbe fallire l'ack di
  // TUTTA la raffica — con il turno riconsegnato all'agente al giro dopo.
  const ids = (Array.isArray(body.delivered_ids) ? body.delivered_ids : [])
    .filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
    .slice(0, MAX_ACK_IDS);

  let delivered = 0;
  if (ids.length > 0) {
    // `delivered_at` solo sulle righe ancora NULL: se una consegna fosse già
    // stata timbrata non se ne sposta l'istante (il box ritenta l'ack quando
    // il POST precedente è andato perso in rete).
    const { data, error } = await admin
      .from("pending_user_messages")
      .update({ delivered_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("delivered_at", null)
      .in("id", ids)
      .select("id");
    if (error) {
      return NextResponse.json(
        { ok: false, error: `ack failed: ${error.message}` },
        { status: 500 },
      );
    }
    delivered = (data || []).length;
  }

  // Chiusura del rendezvous: il gemello di `sync_completed_at` per la chat.
  // Timbro lato server come fa /api/team-state per `chat_requested_at` — i
  // due valori si confrontano fra loro, e l'orologio del box non deve poter
  // dichiarare "consegnato" un istante precedente alla richiesta.
  const { error: bellError } = await admin
    .from("team_state")
    .upsert(
      { user_id: userId, chat_delivered_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (bellError) {
    return NextResponse.json(
      { ok: false, error: `rendezvous failed: ${bellError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, delivered });
}
