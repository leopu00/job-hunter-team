import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { canonicalFileBridgeStoragePath } from "@/lib/file-bridge-storage";

export const dynamic = "force-dynamic";

const BUCKET = "file-transit";
const TTL_MINUTES = 10; // finestra effimera: il file resta nel bucket solo per la visione

// PATCH /api/cloud-sync/file-bridge/:id
// Poller-side (VPS, jht_sync_ Bearer). Transizioni di stato della richiesta:
//
//   { status: 'uploading' } → claim atomico pending→uploading + minta una
//                             signed UPLOAD url usa-e-getta; risponde con
//                             { uploadUrl, storagePath }. La VPS ci fa il PUT
//                             del file (nessuna cred Supabase necessaria).
//   { status: 'ready' }     → set expires_at = now()+TTL (pronto al download).
//   { status: 'error', error } → registra l'errore.
//
// Vedi docs/internal/file-bridge-on-demand-2026-06-07.md
const VALID_STATUS = new Set(["uploading", "ready", "error"]);

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth.data;
  const { id } = await context.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { ok: false, error: "invalid id (uuid expected)" },
      { status: 400 },
    );
  }

  let body: { status?: string; error?: string } = {};
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  const status = String(body.status || "")
    .trim()
    .toLowerCase();
  if (!VALID_STATUS.has(status)) {
    return NextResponse.json(
      {
        ok: false,
        error: `invalid status (allowed: ${[...VALID_STATUS].join(", ")})`,
      },
      { status: 400 },
    );
  }

  // Carica la richiesta (e verifica appartenenza al token).
  const { data: row, error: readErr } = await admin
    .from("file_bridge_requests")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json(
      { ok: false, error: "request_query_failed" },
      { status: 500 },
    );
  }
  if (!row) {
    return NextResponse.json(
      { ok: false, error: "request not found" },
      { status: 404 },
    );
  }

  // ── uploading: claim atomico + signed upload URL ───────────────────
  if (status === "uploading") {
    const storagePath = canonicalFileBridgeStoragePath(userId, id);

    const { data: claimed, error: claimErr } = await admin
      .from("file_bridge_requests")
      .update({
        status: "uploading",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimErr) {
      return NextResponse.json(
        { ok: false, error: "request_claim_failed" },
        { status: 500 },
      );
    }
    if (!claimed) {
      return NextResponse.json(
        { ok: false, error: "request not pending (già reclamata?)" },
        { status: 409 },
      );
    }

    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: true });
    if (signErr || !signed) {
      // Rollback dello stato così il poller può ritentare.
      await admin
        .from("file_bridge_requests")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId);
      return NextResponse.json(
        { ok: false, error: "signed_upload_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      uploadUrl: signed.signedUrl,
      token: signed.token,
      storagePath,
    });
  }

  // ── ready / error ──────────────────────────────────────────────────
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "ready") {
    update.expires_at = new Date(
      Date.now() + TTL_MINUTES * 60 * 1000,
    ).toISOString();
    update.error = null;
  } else if (status === "error") {
    update.error = (body.error || "unknown").slice(0, 2000);
  }

  let transition = admin
    .from("file_bridge_requests")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId);
  // A file is ready only after this token successfully claimed an upload.
  // Error may close either a pending request or an in-progress upload, but
  // cannot rewrite a served/expired request.
  transition =
    status === "ready"
      ? transition.eq("status", "uploading")
      : transition.in("status", ["pending", "uploading"]);
  const { data, error } = await transition
    .select("id, status")
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { ok: false, error: "request_transition_failed" },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "invalid_state_transition" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, request: data });
}
