import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/workspace";
import { generateSyncToken } from "@/lib/cloud-sync/tokens";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import {
  CLIENT_COLUMNS,
  missingClientColumns,
} from "@/lib/cloud-sync/client-identity";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const NOT_CLOUD = NextResponse.json(
  { error: "Cloud sync disponibile solo in modalità cloud" },
  { status: 400 },
);
const UNAUTH = NextResponse.json({ error: "Non autenticato" }, { status: 401 });
const NO_SERVICE_ROLE = NextResponse.json(
  { error: "server misconfigured: SUPABASE_SERVICE_ROLE_KEY mancante" },
  { status: 500 },
);

// Creare e revocare un token si fa solo da qui, col client service_role
// (migrazione 093): la sessione dell'utente legge i suoi token ma non li
// scrive. Con le policy INSERT/UPDATE aperte, chi aveva la sessione poteva
// crearsi un token con un hash scelto da lui e senza scadenza, o togliere
// `revoked_at` a un token revocato, scavalcando questa route. Il service_role
// salta la RLS: l'utente lo decide la sessione verificata qui sotto, e ogni
// scrittura porta il suo `user_id`.
function serviceRole() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

// Tokens lifecycle (list/create/revoke) e' raro per design: 10/min
// per user e' largo per UI normale ma cappa abuso (es. enumeration).
const TOKENS_LIMIT_PER_MIN = 10;

function rateLimitedResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Rate limit superato. Riprova tra poco." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(TOKENS_LIMIT_PER_MIN),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}

export async function GET() {
  if (!isSupabaseConfigured) return NOT_CLOUD;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return UNAUTH;

  const rl = await checkCloudSyncRateLimit(
    "tokens-get",
    user.id,
    TOKENS_LIMIT_PER_MIN,
  );
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  // Le colonne client_* sono la telemetria tecnica che il box dichiara
  // ([CLIENT-VERSION-INVISIBLE]): tornano qui perché chi la produce deve
  // poterla rileggere, e questa GET passa dalla RLS del suo proprietario.
  // expires_at: la lista avvisa prima che il token scolleghi il box.
  const BASE_COLUMNS =
    "id, name, token_prefix, last_used_at, created_at, expires_at";
  const list = (columns: string) =>
    supabase
      .from("cloud_sync_tokens")
      .select(columns)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

  let { data, error } = await list(`${BASE_COLUMNS}, ${CLIENT_COLUMNS}`);
  // Migration 064 non ancora applicata: la pagina mostra i token senza la
  // telemetria invece di non mostrarli affatto.
  if (missingClientColumns(error)) {
    ({ data, error } = await list(BASE_COLUMNS));
  }

  if (error)
    return sanitizedError(error, { status: 500, scope: "cloud-sync/tokens" });
  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) return NOT_CLOUD;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return UNAUTH;

  const rl = await checkCloudSyncRateLimit(
    "tokens-post",
    user.id,
    TOKENS_LIMIT_PER_MIN,
  );
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  let body: { name?: string; expires_in_days?: number | null } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const name = body.name?.trim() ?? "";
  if (name.length < 1 || name.length > 100) {
    return NextResponse.json(
      { error: "Nome obbligatorio (1-100 caratteri)" },
      { status: 400 },
    );
  }

  // Scadenza token: nessuna, salvo richiesta esplicita. Fino al 07/10 i token
  // creati da UI scadevano a 90 giorni (audit #1); per decisione
  // dell'operatore il default e' tolto, perche' un box il cui token scade
  // si scollega in silenzio e va ri-pairato a mano. La difesa resta la
  // revoca dal web (DELETE qui sotto), che verifyBearerToken rispetta subito.
  // `expires_in_days` > 0 continua a fissare una scadenza; assente, `null` o
  // `0` = nessuna scadenza. Un valore non valido e' rifiutato: con il default
  // a "nessuna scadenza", ignorarlo trasformerebbe una scadenza chiesta in un
  // token perpetuo.
  const MAX_TTL_DAYS = 3650;
  const requested = body.expires_in_days;
  let expiresAt: string | null = null;
  if (requested !== undefined && requested !== null && requested !== 0) {
    if (
      typeof requested !== "number" ||
      !Number.isFinite(requested) ||
      requested < 0 ||
      requested > MAX_TTL_DAYS
    ) {
      return NextResponse.json(
        { error: `expires_in_days non valido (0-${MAX_TTL_DAYS})` },
        { status: 400 },
      );
    }
    expiresAt = new Date(Date.now() + requested * 86_400_000).toISOString();
  }

  const admin = serviceRole();
  if (!admin) return NO_SERVICE_ROLE;

  const { token, prefix, hash } = generateSyncToken();
  const { data, error } = await admin
    .from("cloud_sync_tokens")
    .insert({
      user_id: user.id,
      name,
      token_prefix: prefix,
      token_hash: hash,
      expires_at: expiresAt,
    })
    .select("id, name, token_prefix, created_at, expires_at")
    .single();

  if (error)
    return sanitizedError(error, { status: 500, scope: "cloud-sync/tokens" });
  return NextResponse.json({ ...data, token }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!isSupabaseConfigured) return NOT_CLOUD;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return UNAUTH;

  const rl = await checkCloudSyncRateLimit(
    "tokens-delete",
    user.id,
    TOKENS_LIMIT_PER_MIN,
  );
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSec);

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });

  const admin = serviceRole();
  if (!admin) return NO_SERVICE_ROLE;

  // Il filtro su `user_id` è l'unico confine: il service_role non ha RLS, e
  // senza di esso l'id di un token altrui basterebbe a revocarlo. Nessuna
  // riga toccata (id inesistente o di un altro utente) = 404.
  const { data, error } = await admin
    .from("cloud_sync_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error)
    return sanitizedError(error, { status: 500, scope: "cloud-sync/tokens" });
  if (!data || data.length === 0)
    return NextResponse.json({ error: "Token non trovato" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
