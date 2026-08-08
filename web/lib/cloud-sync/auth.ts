import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashSyncToken } from "@/lib/cloud-sync/tokens";
import {
  CLIENT_COLUMNS,
  clientIdentityChanged,
  clientIdentityPatch,
  missingClientColumns,
  parseClientHeader,
} from "@/lib/cloud-sync/client-identity";

const BEARER_RE = /^Bearer\s+(jht_sync_[A-Za-z0-9_\-]+)$/;

export interface VerifiedToken {
  userId: string;
  tokenId: string;
  name: string;
  admin: ReturnType<typeof createAdminClient>;
}

export type VerifyResult =
  | { ok: true; data: VerifiedToken }
  | { ok: false; res: NextResponse };

// Throttle write su last_used_at: una sola UPDATE/ora per token, anche
// se il cloud daemon fa decine di request/min. Il campo era usato solo
// come "ultima volta visto" indicativo: granularità 1h è sufficiente,
// la write su ogni request saturava il Disk IO Budget (vedi
// docs/sessions/2026-05-18-supabase-disk-io-investigation/).
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  revoked_at: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  client_version?: string | null;
  client_platform?: string | null;
  client_capabilities?: string[] | null;
}

type PostgrestFailure = {
  code?: string | null;
  message?: string | null;
} | null;

// Una volta scoperto che la 064 non c'è, non si ritenta la select estesa a
// ogni request: il flag vive quanto l'istanza serverless, e un deploy dello
// schema fa comunque ripartire istanze nuove.
//
// Il rovescio, da sapere: applicare la 064 a caldo NON riaccende la
// telemetria sulle istanze già in volo che avevano trovato le colonne
// assenti — riparte quando quelle istanze vengono ricreate. È accettabile
// perché il caso dura il tempo di un disallineamento fra due deploy, ma se
// dopo una migration la versione dei box non compare, è qui che si guarda
// prima di cercare un guasto altrove.
let clientColumnsPresent = true;

/**
 * Verifica un Bearer token jht_sync_... contro cloud_sync_tokens.
 * Aggiorna last_used_at fire-and-forget (throttle 1h). Ritorna admin client per la route.
 */
export async function verifyBearerToken(
  req: NextRequest,
): Promise<VerifyResult> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(BEARER_RE);
  if (!match) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Bearer token mancante o malformato" },
        { status: 401 },
      ),
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "server misconfigured: SUPABASE_SERVICE_ROLE_KEY mancante" },
        { status: 500 },
      ),
    };
  }

  const hash = hashSyncToken(match[1]);
  const BASE_COLUMNS =
    "id, user_id, name, revoked_at, last_used_at, expires_at";
  const lookup = (columns: string) =>
    admin
      .from("cloud_sync_tokens")
      .select(columns)
      .eq("token_hash", hash)
      .maybeSingle();

  let { data, error } = (await lookup(
    clientColumnsPresent ? `${BASE_COLUMNS}, ${CLIENT_COLUMNS}` : BASE_COLUMNS,
  )) as { data: TokenRow | null; error: PostgrestFailure };

  // Il web può essere in produzione prima che la 064 sia applicata: in quel
  // caso si rinuncia alla telemetria e si autentica lo stesso. Far fallire
  // ogni chiamata cloud-sync per una colonna di versione sarebbe un guasto
  // molto più grande di quello che quella colonna serve a evitare.
  if (missingClientColumns(error)) {
    clientColumnsPresent = false;
    ({ data, error } = (await lookup(BASE_COLUMNS)) as {
      data: TokenRow | null;
      error: PostgrestFailure;
    });
  }

  if (error) {
    return {
      ok: false,
      res: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }
  if (!data) {
    return {
      ok: false,
      res: NextResponse.json({ error: "token non valido" }, { status: 401 }),
    };
  }
  if (data.revoked_at) {
    return {
      ok: false,
      res: NextResponse.json({ error: "token revocato" }, { status: 401 }),
    };
  }
  // Scadenza (audit #1): expires_at NULL = nessuna scadenza (device headless).
  // Se valorizzato e nel passato → token scaduto, 401.
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      res: NextResponse.json({ error: "token scaduto" }, { status: 401 }),
    };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  const touchLastUsed =
    !data.last_used_at ||
    Date.now() - new Date(data.last_used_at).getTime() > LAST_USED_THROTTLE_MS;
  if (touchLastUsed) patch.last_used_at = now;

  // Identità del client ([CLIENT-VERSION-INVISIBLE]): la scriviamo quando la
  // dichiarazione cambia — un aggiornamento del box è raro, l'header è
  // identico per settimane — e la accodiamo alla stessa UPDATE di
  // last_used_at, così una versione nuova non raddoppia le write.
  const declared = clientColumnsPresent
    ? parseClientHeader(req.headers.get("x-jht-client"))
    : null;
  if (declared && clientIdentityChanged(data, declared)) {
    Object.assign(patch, clientIdentityPatch(declared, now));
  } else if (declared && touchLastUsed) {
    patch.client_seen_at = now;
  }

  if (Object.keys(patch).length > 0) {
    // Fire-and-forget vero: niente await, la request risponde senza
    // attendere il write. L'errore viene silenziato perché non blocca.
    void admin
      .from("cloud_sync_tokens")
      .update(patch)
      .eq("id", data.id)
      .then(() => undefined);
  }

  return {
    ok: true,
    data: { userId: data.user_id, tokenId: data.id, name: data.name, admin },
  };
}
