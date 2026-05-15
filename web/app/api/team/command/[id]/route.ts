import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/team/command/[id]
//
// Polling-side: la UI dopo POST /api/team/command riceve { command: { id } }
// e polla qui ogni ~1.5s finché status diventa terminal (done|error). Auth
// via Supabase user session; RLS team_commands "users select own" garantisce
// che il caller veda solo le proprie righe.
//
// Risposta:
//   { ok: true, status: 'pending'|'running'|'done'|'error',
//     requested_at, processed_at?, action, payload, error? }
//
// 404 se il comando non esiste (o appartiene a un altro user → RLS nasconde).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authBlock = await requireAuth();
  if (authBlock) return authBlock;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, error: "id non valido (UUID atteso)" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_commands")
    .select("id, action, payload, status, requested_at, processed_at, error")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: `query failed: ${error.message}` },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "comando non trovato" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, ...data });
}
