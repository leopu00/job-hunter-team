import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/workspace";
import { DEVICE_CODE_RE } from "@/lib/cloud-sync/pairing";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const NOT_CLOUD = NextResponse.json(
  { error: "Cloud sync disponibile solo in modalità cloud" },
  { status: 400 },
);

// Polling 1Hz max consentito (CLI default 2s = 30/min). Cap a 60/min
// per IP per ammortizzare jitter di rete senza permettere brute-force
// su device_code (che e' 32 hex chars, 128 bit entropy comunque).
const POLL_LIMIT_PER_MIN = 60;

/**
 * POST /api/cloud-sync/device-poll
 *
 * Endpoint pubblico (no auth): il CLI `jht cloud login` chiama questo
 * endpoint ripetutamente con il device_code ricevuto da device-init,
 * per scoprire se l'utente ha approvato il pairing.
 *
 * Status flow:
 *   pending  → 202 { status: 'pending' }
 *             (CLI continua a polling)
 *   approved → 200 { status: 'approved', token, user_id, token_name }
 *             ATOMICO: marca consumed e cancella approved_token nel DB
 *             (one-shot, il token non e' mai recuperabile due volte)
 *   expired  → 410 { status: 'expired' }
 *             (CLI deve riavviare il flow)
 *   not found → 404 { status: 'not_found' }
 *
 * Body atteso: { device_code: "<hex>" }
 *
 * Sicurezza:
 * - device_code e' bearer-like: 32 hex chars (128 bit). Non e' segreto
 *   utente-facing ma non puo' essere indovinato.
 * - One-shot redemption: dopo approved → consumed, il token non e'
 *   piu' leggibile. Difesa contro replay.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NOT_CLOUD;

  let body: { device_code?: string } = {};
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const device_code = body.device_code?.trim() ?? "";
  if (!DEVICE_CODE_RE.test(device_code)) {
    return NextResponse.json(
      { error: "device_code malformato" },
      { status: 400 },
    );
  }

  // Rate limit per device_code (non per IP) — il CLI legittimo usa SEMPRE
  // lo stesso device_code, mentre un attaccante che cambia device_code ad
  // ogni request non guadagna nulla (deve indovinare un valore valido).
  const rl = await checkCloudSyncRateLimit(
    "device-poll",
    device_code,
    POLL_LIMIT_PER_MIN,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit superato. Aumenta il polling interval." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": String(POLL_LIMIT_PER_MIN),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "server misconfigured: SUPABASE_SERVICE_ROLE_KEY mancante" },
      { status: 500 },
    );
  }

  const { data: session, error } = await admin
    .from("cloud_sync_pairing_sessions")
    .select(
      "device_code, status, user_id, approved_token, approved_token_id, expires_at",
    )
    .eq("device_code", device_code)
    .maybeSingle();

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/device-poll",
    });
  }
  if (!session) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  // Auto-marca expired se passata la TTL (cleanup lazy lato read).
  if (new Date(session.expires_at).getTime() < Date.now()) {
    if (session.status !== "expired") {
      await admin
        .from("cloud_sync_pairing_sessions")
        .update({ status: "expired" })
        .eq("device_code", device_code);
    }
    return NextResponse.json({ status: "expired" }, { status: 410 });
  }

  if (session.status === "pending") {
    return NextResponse.json({ status: "pending" }, { status: 202 });
  }

  if (session.status === "expired") {
    return NextResponse.json({ status: "expired" }, { status: 410 });
  }

  if (session.status === "consumed") {
    // Il token e' gia' stato letto una volta. Difesa contro replay.
    return NextResponse.json({ status: "consumed" }, { status: 410 });
  }

  if (session.status === "approved") {
    if (!session.approved_token || !session.user_id) {
      return NextResponse.json({ status: "pending" }, { status: 202 });
    }

    // ATOMIC redemption: marca consumed E cancella approved_token in
    // un solo update. Il token e' poi tornato al CLI e cancellato dal DB
    // — non sopravvive in clear text dopo la redemption.
    const tokenToReturn = session.approved_token;
    const userId = session.user_id;

    // Recuperiamo il name del token per UX nel CLI.
    const { data: tokenRow } = await admin
      .from("cloud_sync_tokens")
      .select("name")
      .eq("id", session.approved_token_id ?? "")
      .maybeSingle();

    const { error: updateErr } = await admin
      .from("cloud_sync_pairing_sessions")
      .update({
        status: "consumed",
        approved_token: null, // wipe in clear, restano solo metadati
        consumed_at: new Date().toISOString(),
      })
      .eq("device_code", device_code)
      .eq("status", "approved"); // CAS-like: protegge contro double-redemption

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      status: "approved",
      token: tokenToReturn,
      user_id: userId,
      token_name: tokenRow?.name ?? "cli-pairing",
    });
  }

  return NextResponse.json({ status: session.status }, { status: 500 });
}
