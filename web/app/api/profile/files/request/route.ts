import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// POST /api/profile/files/request  { name }
// Browser-side (sessione utente Supabase). Crea una richiesta di bridge
// on-demand per il file `name`: il poller VPS la prenderà, caricherà il file
// nel bucket effimero e la marcherà 'ready'. Il client poi polla
// /api/profile/files/request/:id finché ottiene la signed download URL.
// Vedi docs/internal/file-bridge-on-demand-2026-06-07.md
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "non autenticato" }, { status: 401 });
  }

  let body: { name?: string } = {};
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "nome file richiesto" }, { status: 400 });
  }

  // INSERT via sessione utente: la RLS (file_bridge_requests insert own)
  // garantisce user_id = auth.uid().
  const { data, error } = await supabase
    .from("file_bridge_requests")
    .insert({ user_id: user.id, file_name: name, status: "pending" })
    .select("id")
    .single();

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "profile/files/request",
    });
  }
  return NextResponse.json({ requestId: data.id });
}
