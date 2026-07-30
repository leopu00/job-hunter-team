import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/workspace";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { generateSyncToken } from "@/lib/cloud-sync/tokens";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const NOT_CLOUD = NextResponse.json(
  { error: "Cloud sync disponibile solo in modalità cloud" },
  { status: 400 },
);

// device-register e' chiamato 1 volta dalla VPS appena dopo install.sh.
// Cap 6/min per IP: lascia spazio a retry su rete instabile, blocca abuso.
const REGISTER_LIMIT_PER_MIN = 6;

// I refresh_token emessi dal nuovo auth Supabase sono stringhe opaque
// brevi (~12 char, es. "7q436frro2yw"), non JWT. Il vecchio minimo 16
// rifiutava i token reali con HTTP 400 "refresh_token malformato".
const REFRESH_TOKEN_RE = /^[A-Za-z0-9_\-.]{8,2048}$/;
const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/cloud-sync/device-register
 *
 * Endpoint NON autenticato (no Bearer): chiamato dal container VPS al
 * primo boot, dopo che install.sh ha salvato il pairing-token in
 * /jht_home/.pairing-token. Il pairing-token contiene il refresh_token
 * Supabase dell'utente (generato lato desktop in
 * desktop/auth/index.js#getPairingToken), che qui viene scambiato per
 * mintare un jht_sync_* token associato all'account.
 *
 * Body atteso: {
 *   user_id:       string  // UUID dichiarato (deve coincidere con quello del refresh)
 *   refresh_token: string  // refresh_token Supabase dal pairing payload
 *   device_name?:  string  // label del token (default: vps-pairing-YYYY-MM-DD)
 * }
 *
 * Sicurezza:
 * - Il refresh_token autentica l'utente: chi lo possiede E' l'utente.
 *   Lo verifichiamo chiamando POST /auth/v1/token?grant_type=refresh_token
 *   sul progetto Supabase. Risposta valida → user.id confermato.
 * - Confrontiamo user.id ricevuto da Supabase con `user_id` dichiarato:
 *   se non coincidono il pairing-token e' stato manomesso → 403.
 * - Rate limit per IP perche' non c'e' identita' prima della verifica.
 * - One-shot per pairing-token: il chiamante deve scartare il
 *   refresh_token dopo aver ricevuto il jht_sync_* (e' nel client side).
 *
 * Trade-off accettato (vedi memoria project_vps_setup_decisions.md):
 *   il refresh_token Supabase autorizza piu' di un singolo cloud_sync_token,
 *   ma la superficie e' limitata: passa solo localmente da app a install.sh
 *   via SSH, e da install.sh a questo endpoint via HTTPS. In v1 piu' avanti
 *   passeremo a un token scoped via Supabase Edge Function o tabella
 *   `device_pairings` dedicata (vedi BACKLOG `[JHT-DESKTOP-LOGIN]`).
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NOT_CLOUD;

  // Rate limit per IP — niente identita' prima dell'auth.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkCloudSyncRateLimit(
    "device-register",
    ip,
    REGISTER_LIMIT_PER_MIN,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit superato. Riprova tra poco." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": String(REGISTER_LIMIT_PER_MIN),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let body: { user_id?: string; refresh_token?: string; device_name?: string } =
    {};
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const claimedUserId = (body.user_id || "").trim();
  const refreshToken = (body.refresh_token || "").trim();
  if (!USER_ID_RE.test(claimedUserId)) {
    return NextResponse.json(
      { error: "user_id malformato (UUID atteso)" },
      { status: 400 },
    );
  }
  if (!REFRESH_TOKEN_RE.test(refreshToken)) {
    return NextResponse.json(
      { error: "refresh_token malformato" },
      { status: 400 },
    );
  }

  // Verifica il refresh_token contro Supabase: se valido restituisce
  // {user, access_token, refresh_token, ...}. NON usiamo il nuovo
  // refresh_token (rotazione lato Supabase): quel token viene scartato.
  const supa = getSupabaseConfig();
  if (!supa.configured) {
    return NextResponse.json(
      { error: "cloud sync non configurato" },
      { status: 500 },
    );
  }
  let refreshed: { user?: { id?: string }; error?: { message?: string } } = {};
  try {
    const res = await fetch(
      `${supa.url}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supa.anonKey,
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
    );
    refreshed = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `pairing-token non valido: ${refreshed.error?.message || `HTTP ${res.status}`}`,
        },
        { status: 401 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Verifica pairing-token fallita: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const verifiedUserId = refreshed.user?.id;
  if (!verifiedUserId) {
    return NextResponse.json(
      { error: "Risposta Supabase malformata (user.id mancante)" },
      { status: 502 },
    );
  }
  if (verifiedUserId !== claimedUserId) {
    return NextResponse.json(
      {
        error:
          "pairing-token manomesso: user_id non coincide con il refresh_token",
      },
      { status: 403 },
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

  const tokenName = (
    (body.device_name || "").trim() ||
    `vps-pairing-${new Date().toISOString().slice(0, 10)}`
  ).slice(0, 100);

  const { token, prefix, hash } = generateSyncToken();
  // Scadenza (audit #1): i device VPS sono headless e NON hanno auto-refresh
  // del sync token — una scadenza secca li costringerebbe a un ri-pairing
  // manuale ricorrente. Quindi expires_at = NULL (nessuna scadenza), scelta
  // esplicita e tracciata. La revoca resta possibile via UI (`revoked_at`).
  const { data, error } = await admin
    .from("cloud_sync_tokens")
    .insert({
      user_id: verifiedUserId,
      name: tokenName,
      token_prefix: prefix,
      token_hash: hash,
      expires_at: null,
    })
    .select("id, name, token_prefix, created_at")
    .single();

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/device-register",
    });
  }

  // Segna lo stato di onboarding: il consume del pairing token = setup
  // VPS completato. Il flag e' "primo successo" — pair successivi non
  // sovrascrivono vps_setup_completed_at. Se la upsert fallisce, NON
  // facciamo fallire la response: il device-register e' gia' andato
  // e il flag e' un side-effect di telemetria/UX, non un invariante.
  try {
    const { data: existing } = await admin
      .from("user_onboarding_state")
      .select("vps_setup_completed_at")
      .eq("user_id", verifiedUserId)
      .maybeSingle();
    if (!existing?.vps_setup_completed_at) {
      const nowIso = new Date().toISOString();
      await admin.from("user_onboarding_state").upsert(
        {
          user_id: verifiedUserId,
          vps_setup_completed_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "user_id" },
      );
    }
  } catch {
    // best-effort: il setup principale e' andato, il flag lo recupera
    // al prossimo pairing oppure via backfill.
  }

  return NextResponse.json(
    {
      ok: true,
      token,
      token_name: data.name,
      token_prefix: data.token_prefix,
      user_id: verifiedUserId,
    },
    { status: 201 },
  );
}
