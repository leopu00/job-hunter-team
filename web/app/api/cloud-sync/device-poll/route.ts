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

type PairingRedemption = {
  status:
    | "not_found"
    | "pending"
    | "approved"
    | "consumed"
    | "expired"
    | "invalid";
  approved_token: string | null;
  user_id: string | null;
  approved_token_id: string | null;
  token_name: string | null;
};

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

  // La RPC possiede lettura, CAS, wipe e revoca nella stessa transazione.
  // Leggere il token qui e poi "chiedere" un UPDATE non basta: il perdente
  // di una race potrebbe ignorare uno zero-row update e restituire plaintext.
  const { data: session, error } = (await admin
    .rpc("redeem_cloud_sync_pairing", { p_device_code: device_code })
    .maybeSingle()) as {
    data: PairingRedemption | null;
    error: { message: string } | null;
  };

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/device-poll",
    });
  }
  if (!session) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (session.status === "not_found") {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
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
      return NextResponse.json({ status: "invalid" }, { status: 500 });
    }
    return NextResponse.json({
      status: "approved",
      token: session.approved_token,
      user_id: session.user_id,
      token_name: session.token_name ?? "cli-pairing",
    });
  }

  return NextResponse.json({ status: session.status }, { status: 500 });
}
