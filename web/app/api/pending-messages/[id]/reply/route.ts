import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isLocalRequest } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/workspace";
import { getWorkspacePath } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { replyPendingMessageLocal } from "@/lib/local-queries";

export const dynamic = "force-dynamic";

const MAX_REPLY_LENGTH = 4000;

// L'utente risponde a un messaggio dell'agente via dashboard. La row
// viene anche ack-ata implicitamente (una reply implica visione).
// L'agente vedra' la risposta al prossimo tick via marker prompt-injection
// (filtro: user_reply_at IS NOT NULL AND agent_seen_reply_at IS NULL).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id mancante" }, { status: 400 });
  }

  let body: { reply?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "body JSON non valido" },
      { status: 400 },
    );
  }
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (!reply) {
    return NextResponse.json({ error: "reply vuota" }, { status: 400 });
  }
  if (reply.length > MAX_REPLY_LENGTH) {
    return NextResponse.json(
      { error: `reply troppo lunga (max ${MAX_REPLY_LENGTH} char)` },
      { status: 400 },
    );
  }

  if (await isLocalRequest()) {
    const ws = await getWorkspacePath();
    if (!ws) {
      return NextResponse.json(
        { error: "workspace non trovato" },
        { status: 500 },
      );
    }
    try {
      const changed = replyPendingMessageLocal(ws, id, reply);
      return NextResponse.json({ ok: true, changed });
    } catch (e) {
      return NextResponse.json(
        { error: `reply fallita: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  }

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

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("pending_user_messages")
    .update({
      user_reply: reply,
      user_reply_at: now,
      // ack atomico se non gia' settato — riusa il valore esistente quando c'e'.
      acknowledged_at: now,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, changed: (data?.length ?? 0) > 0 });
}
