import { NextResponse } from "next/server";
import { requireAuth, isLocalRequest } from "@/lib/auth";
import { isSupabaseConfigured, workspaceHasDb } from "@/lib/workspace";
import { getWorkspacePath } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { ackAllPendingMessagesLocal } from "@/lib/local-queries";

export const dynamic = "force-dynamic";

// Marca come letti TUTTI i messaggi web pendenti dell'utente in un colpo solo.
// Stesso filtro della query che popola la card (delivered_via='web' e non
// ancora ack): cosi' azzera esattamente cio' che la dashboard mostra. I DIGEST
// del team si riaccumulano nel tempo e ackarli uno a uno non e' praticabile.
// Idempotente: nessun messaggio pendente -> 200 ok=true, changed=0.
export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  // Local mode: SQLite. Lo stato verra' pushato al cloud al prossimo tick.
  // Gate identico a ws() in lib/queries.ts (host locale + DB presente),
  // vedi commento in [id]/ack/route.ts.
  if ((await isLocalRequest()) && workspaceHasDb()) {
    const ws = await getWorkspacePath();
    if (!ws) {
      return NextResponse.json(
        { error: "workspace non trovato" },
        { status: 500 },
      );
    }
    try {
      const changed = ackAllPendingMessagesLocal(ws);
      return NextResponse.json({ ok: true, changed });
    } catch (e) {
      return NextResponse.json(
        { error: `ack-all fallito: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  }

  // Cloud mode: Supabase con RLS. user_id vincola alle sole righe dell'utente.
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "Supabase non configurato" },
      { status: 500 },
    );
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("pending_user_messages")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("delivered_via", "web")
    .is("acknowledged_at", null)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, changed: data?.length ?? 0 });
}
