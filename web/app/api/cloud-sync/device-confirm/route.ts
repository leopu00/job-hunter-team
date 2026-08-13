import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/workspace";
import { generateSyncToken } from "@/lib/cloud-sync/tokens";
import { normalizeUserCode } from "@/lib/cloud-sync/pairing";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const NOT_CLOUD = NextResponse.json(
  { error: "Cloud sync disponibile solo in modalità cloud" },
  { status: 400 },
);
const UNAUTH = NextResponse.json({ error: "Non autenticato" }, { status: 401 });

// Confirm e' chiamato dall'utente loggato sul web — UNA volta per pairing.
// Cap a 20 tentativi/10 min per user: user_code ha circa 1,15 miliardi di
// combinazioni (36^6); il bucket persistente limita i tentativi cross-instance.
const CONFIRM_LIMIT_PER_MIN = 20;

/**
 * POST /api/cloud-sync/device-confirm
 *
 * Endpoint protetto (richiede utente autenticato): chiamato dalla pagina
 * /cli-link quando l'utente conferma il pairing del device.
 *
 * Body atteso: { user_code: "ABCD-1234", token_name?: "vps-marco" }
 *
 * Logica:
 * 1. Cerca la sessione pending con quel user_code (non scaduta)
 * 2. Genera un nuovo jht_sync_* token via generateSyncToken
 * 3. Lo inserisce in cloud_sync_tokens (associato all'user)
 * 4. Aggiorna la sessione pending → approved con (user_id, approved_token,
 *    approved_token_id, approved_at)
 * 5. Ritorna success — il token sara' consegnato al CLI via device-poll
 *
 * Sicurezza:
 * - User_code ha ~18B entropy nominali, ma con rate limit 20/min per user
 *   e cap 30/min globali sul polling, brute-force impraticabile in 10min TTL.
 * - Solo l'utente loggato puo' confermare → il VPS riceve un token associato
 *   all'account giusto, no token squatting.
 * - Race condition double-approve: gestita con condition WHERE status='pending'
 *   nell'UPDATE — il secondo approve fallisce silenzioso.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NOT_CLOUD;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return UNAUTH;

  const rl = await checkCloudSyncRateLimit(
    "device-confirm",
    user.id,
    CONFIRM_LIMIT_PER_MIN,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit superato. Riprova tra poco." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": String(CONFIRM_LIMIT_PER_MIN),
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

  // Consume the durable bucket before parsing or looking up user_code. An RPC
  // error is fail-closed: malformed/non-existent codes count too.
  const { data: attempt, error: attemptErr } = await admin.rpc(
    "consume_pairing_attempt",
    { p_user_id: user.id },
  );
  const attemptRow = Array.isArray(attempt) ? attempt[0] : attempt;
  if (attemptErr || !attemptRow?.allowed) {
    return NextResponse.json(
      { error: "Troppi tentativi. Riprova più tardi." },
      {
        status: 429,
        headers: {
          "Retry-After": String(attemptRow?.retry_after_seconds ?? 60),
        },
      },
    );
  }

  let body: { user_code?: string; token_name?: string } = {};
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const userCode = normalizeUserCode(body.user_code);
  if (!userCode) {
    return NextResponse.json(
      { error: "user_code malformato (atteso AAAA-1234)" },
      { status: 400 },
    );
  }

  const tokenName = (
    body.token_name?.trim() ||
    `cli-pairing-${new Date().toISOString().slice(0, 10)}`
  ).slice(0, 100);

  // Cerca la sessione pending con quel user_code.
  const { data: session, error: lookupErr } = await admin
    .from("cloud_sync_pairing_sessions")
    .select("device_code, user_code, status, expires_at")
    .eq("user_code", userCode)
    .eq("status", "pending")
    .maybeSingle();

  if (lookupErr) {
    return sanitizedError(lookupErr, {
      status: 500,
      scope: "cloud-sync/device-confirm",
      publicMessage: "conferma dispositivo non disponibile",
    });
  }
  if (!session) {
    return NextResponse.json(
      { error: "Codice non valido o gia' usato. Riprova dal terminale." },
      { status: 404 },
    );
  }
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await admin
      .from("cloud_sync_pairing_sessions")
      .update({ status: "expired" })
      .eq("device_code", session.device_code);
    return NextResponse.json(
      { error: "Codice scaduto. Riavvia jht cloud login dal terminale." },
      { status: 410 },
    );
  }

  // Genera + inserisce il token effettivo.
  const { token, prefix, hash } = generateSyncToken();
  const { data: tokenRow, error: tokenErr } = await admin
    .from("cloud_sync_tokens")
    .insert({
      user_id: user.id,
      name: tokenName,
      token_prefix: prefix,
      token_hash: hash,
      // Prima del riscatto il bearer condivide la TTL della sessione. La RPC
      // lo rende no-expiry soltanto nello stesso commit che consuma il token.
      expires_at: session.expires_at,
    })
    .select("id, name, token_prefix, created_at")
    .single();

  if (tokenErr) {
    return sanitizedError(tokenErr, {
      status: 500,
      scope: "cloud-sync/device-confirm",
      publicMessage: "conferma dispositivo non disponibile",
    });
  }

  // Approva la sessione (CAS contro double-approve).
  const { data: updated, error: approveErr } = await admin
    .from("cloud_sync_pairing_sessions")
    .update({
      status: "approved",
      user_id: user.id,
      approved_token: token,
      approved_token_id: tokenRow.id,
      approved_at: new Date().toISOString(),
    })
    .eq("device_code", session.device_code)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .select("device_code")
    .maybeSingle();

  if (approveErr) {
    // Rollback del token che abbiamo gia' inserito
    await admin
      .from("cloud_sync_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenRow.id);
    return sanitizedError(approveErr, {
      status: 500,
      scope: "cloud-sync/device-confirm",
      publicMessage: "conferma dispositivo non disponibile",
    });
  }
  if (!updated) {
    // Race: qualcun altro ha gia' approvato. Rollback token.
    await admin
      .from("cloud_sync_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenRow.id);
    return NextResponse.json(
      {
        error:
          "Sessione gia' confermata da un'altra finestra. Riavvia dal terminale.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    token_name: tokenRow.name,
    token_prefix: tokenRow.token_prefix,
  });
}
