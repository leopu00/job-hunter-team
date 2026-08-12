// Cancellazione dell'account: irreversibile, su richiesta esplicita.
//
// Tre protezioni, ognuna contro un errore diverso:
//
// 1. L'utente da cancellare è SEMPRE quello della sessione. Il corpo della
//    richiesta non può indicarne un altro — non c'è nemmeno il campo. È
//    così che «cancellare l'account sbagliato» smette di essere un rischio
//    da validare e diventa una cosa che il codice non sa fare.
// 2. Va rispedita l'email esatta dell'account. Non protegge da un
//    attaccante che ha già la sessione, ma protegge dal click distratto,
//    che è il caso di gran lunga più probabile.
// 3. Il conteggio di ciò che verrà cancellato si ottiene con GET, prima:
//    l'utente vede COSA sparisce prima di confermare, non dopo.

import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import {
  DeletionError,
  deleteAccountData,
  deletionAuditLine,
} from "@/lib/account-deletion";
import { USER_DATA_TABLES } from "@/lib/account-data-tables";

// L'elenco è quello condiviso con l'export: «cosa posso esportare» e
// «cosa viene cancellato» devono restare la stessa cosa.
const ALL_USER_TABLES = USER_DATA_TABLES;

const NOT_CLOUD = NextResponse.json({ error: "not_cloud" }, { status: 501 });
const UNAUTH = NextResponse.json({ error: "unauthorized" }, { status: 401 });

/** Riferimento non reversibile all'utente, per il log tecnico. */
function userRef(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

/** Anteprima: cosa verrà cancellato. Nessuna scrittura. */
export async function GET() {
  if (!hasSupabaseConfig()) return NOT_CLOUD;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return UNAUTH;

  const admin = createAdminClient();
  const counts: Record<string, number> = {};
  for (const table of ALL_USER_TABLES) {
    const { count } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (count) counts[table] = count;
  }

  return NextResponse.json({
    email: user.email ?? null,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  });
}

export async function POST(req: NextRequest) {
  if (!hasSupabaseConfig()) return NOT_CLOUD;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return UNAUTH;

  let body: { confirmEmail?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Il confronto è sull'email della SESSIONE, non su una passata dal
  // client: l'unica cosa che il client può fare è sbagliarla.
  const typed = String(body.confirmEmail ?? "")
    .trim()
    .toLowerCase();
  const actual = (user.email ?? "").trim().toLowerCase();
  if (!actual || typed !== actual) {
    return NextResponse.json(
      { error: "confirmation_mismatch" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  try {
    const outcome = await deleteAccountData(admin, user.id);
    // Log tecnico senza i dati cancellati: quando, un riferimento non
    // reversibile, e i conteggi.
    console.info(
      deletionAuditLine(userRef(user.id), outcome, new Date().toISOString()),
    );
    return NextResponse.json({ ok: true, removed: outcome.removed });
  } catch (err) {
    // La RPC PostgreSQL fa rollback integrale; Storage è però un sistema
    // esterno e viene svuotato prima, quindi un suo effetto già verificato
    // non è reversibile se il database fallisce dopo. Va detto com'è, non
    // mascherato da successo. Ciò che esce è un CODICE STABILE e la fase,
    // mai un messaggio libero: quello dello storage conterrebbe nomi di file
    // scelti dall'utente, quello di Postgres può riportare il valore che ha
    // violato un vincolo. Vale per client e log allo stesso modo.
    const known = err instanceof DeletionError;
    const code = known ? err.code : "unknown_error";
    const stage = known ? err.stage : "unknown";
    console.error(
      "[account-deletion] fallita:",
      userRef(user.id),
      code,
      stage,
      known && err.count !== undefined ? err.count : "",
    );
    return NextResponse.json(
      { error: "deletion_failed", code, stage },
      { status: 500 },
    );
  }
}
