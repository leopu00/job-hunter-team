import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canonicalFileBridgeStoragePath,
  fileBridgeDownloadName,
  fileBridgeListedObjectPath,
  fileBridgeStoragePrefix,
} from "@/lib/file-bridge-storage";

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
    .select("id, file_name, status, error")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: "request_query_failed" },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json(
      { error: "richiesta non trovata" },
      { status: 404 },
    );
  }

  if (row.status !== "ready") {
    return NextResponse.json({ status: row.status, error: row.error ?? null });
  }

  // Pronto: minta la signed download URL (service-role, bucket privato).
  // `download: <basename>` forza Content-Disposition: attachment → il browser
  // SCARICA il file invece di tentare di aprirlo in una nuova finestra. Così il
  // client usa un <a> anchor (niente window.open, che i popup-blocker fermano
  // perché parte dopo il polling async, fuori dal gesto del click).
  const admin = createAdminClient();
  const storage = admin.storage.from(BUCKET);
  const prefix = fileBridgeStoragePrefix(user.id, row.id);
  const { data: objects, error: listErr } = await storage.list(prefix, {
    limit: 3,
  });
  if (listErr) {
    return NextResponse.json({ error: "storage_list_failed" }, { status: 500 });
  }
  if ((objects || []).some((object) => !object.id)) {
    return NextResponse.json(
      { error: "storage_layout_invalid" },
      { status: 500 },
    );
  }
  const files = (objects || []).filter((object) => object.id);
  const payload = files.find((object) => object.name === "payload");
  if (!payload && files.length !== 1) {
    return NextResponse.json(
      {
        error: files.length === 0 ? "file_not_ready" : "storage_layout_invalid",
      },
      { status: files.length === 0 ? 409 : 500 },
    );
  }
  // New requests always use /payload. A single immediate legacy object is
  // accepted for the short migration window, but only after server-side
  // enumeration beneath the authenticated user/request prefix.
  let storagePath: string;
  try {
    storagePath = payload
      ? canonicalFileBridgeStoragePath(user.id, row.id)
      : fileBridgeListedObjectPath(user.id, row.id, files[0].name);
  } catch {
    return NextResponse.json(
      { error: "storage_layout_invalid" },
      { status: 500 },
    );
  }
  const downloadName = fileBridgeDownloadName(row.file_name);
  const { data: signed, error: signErr } = await storage.createSignedUrl(
    storagePath,
    DOWNLOAD_TTL_SECONDS,
    {
      download: downloadName,
    },
  );
  if (signErr || !signed) {
    return NextResponse.json({ error: "signed_url_failed" }, { status: 500 });
  }

  // Marca 'served' (mantiene expires_at): il purge VPS eliminerà l'oggetto.
  await admin
    .from("file_bridge_requests")
    .update({ status: "served", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  return NextResponse.json({ status: "ready", url: signed.signedUrl });
}
