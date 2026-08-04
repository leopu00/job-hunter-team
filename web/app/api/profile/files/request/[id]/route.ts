import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const BUCKET = "file-transit";
const DOWNLOAD_TTL_SECONDS = 60;

// GET /api/profile/files/request/:id
// Browser-side polling. Ritorna lo stato della richiesta di bridge; quando
// 'ready' minta una signed download URL (TTL corto) per aprire il file e
// marca la richiesta 'served' (così il purge la elimina). Lettura della riga
// via sessione utente (RLS own); il signing dello Storage richiede il
// service-role (bucket privato).
// Vedi docs/internal/file-bridge-on-demand-2026-06-07.md
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "non autenticato" }, { status: 401 });
  }

  // RLS: l'utente legge solo le proprie richieste.
  const { data: row, error } = await supabase
    .from("file_bridge_requests")
    .select("id, status, storage_path, error")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "profile/files/request/[id]",
    });
  }
  if (!row) {
    return NextResponse.json(
      { error: "richiesta non trovata" },
      { status: 404 },
    );
  }

  if (row.status !== "ready" || !row.storage_path) {
    return NextResponse.json({ status: row.status, error: row.error ?? null });
  }

  // Pronto: minta la signed download URL (service-role, bucket privato).
  // `download: <basename>` forza Content-Disposition: attachment → il browser
  // SCARICA il file invece di tentare di aprirlo in una nuova finestra. Così il
  // client usa un <a> anchor (niente window.open, che i popup-blocker fermano
  // perché parte dopo il polling async, fuori dal gesto del click).
  const downloadName = row.storage_path.split("/").pop() || "cv.pdf";
  const admin = createAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, DOWNLOAD_TTL_SECONDS, {
      download: downloadName,
    });
  if (signErr || !signed) {
    return NextResponse.json(
      { error: `signed url failed: ${signErr?.message || "unknown"}` },
      { status: 500 },
    );
  }

  // Marca 'served' (mantiene expires_at): il purge VPS eliminerà l'oggetto.
  await admin
    .from("file_bridge_requests")
    .update({ status: "served", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  return NextResponse.json({ status: "ready", url: signed.signedUrl });
}
