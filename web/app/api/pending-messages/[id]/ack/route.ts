import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isLocalRequest } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/workspace";
import { getWorkspacePath } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { ackPendingMessageLocal } from "@/lib/local-queries";

export const dynamic = "force-dynamic";

// Marca un messaggio come letto. Idempotente: gia' ack-ato -> 200 ok=true,
// changed=false. Non distrugge il messaggio — la dashboard lo nasconde e
// l'agente puo' comunque cercarlo nello storico.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id mancante" }, { status: 400 });
  }

  // Local mode: scrive su SQLite. Lo stato verra' poi pushato al cloud
  // al prossimo tick del daemon — vedi handlePush in cli/src/commands/cloud.js.
  if (await isLocalRequest()) {
    const ws = await getWorkspacePath();
    if (!ws) {
      return NextResponse.json(
        { error: "workspace non trovato" },
        { status: 500 },
      );
    }
    try {
      const changed = ackPendingMessageLocal(ws, id);
      return NextResponse.json({ ok: true, changed });
    } catch (e) {
      return NextResponse.json(
        { error: `ack fallito: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  }

  // Cloud mode: Supabase con RLS. L'auth verifica user_id; la WHERE su id
  // resta esposta solo all'utente proprietario.
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
    .eq("id", id)
    .eq("user_id", user.id)
    .is("acknowledged_at", null)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, changed: (data?.length ?? 0) > 0 });
}
