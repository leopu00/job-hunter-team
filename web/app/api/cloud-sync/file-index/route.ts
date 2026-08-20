import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { invalidJsonBody } from "@/app/api/_lib/error-body";

export const dynamic = "force-dynamic";

// POST /api/cloud-sync/file-index
// Poller-side (VPS, jht_sync_ Bearer). La VPS pubblica l'INDICE dei file
// presenti sul disco del container (nessun binario): nome, size, mime, sha,
// path-sul-vps. Il web lo legge per la sezione "Anteprima CV" quando gira su
// cloud (dove il filesystem non esiste).
//
// Body: { files: [{ name, category?, sha256?, size?, mime?, location_on_vps? }] }
//
// Semantica: replace-all dell'indice dell'utente (full snapshot). Upsert dei
// presenti + delete di quelli spariti dal disco.
// Vedi docs/internal/file-bridge-on-demand-2026-06-07.md
interface IndexedFile {
  name: string;
  category?: string;
  sha256?: string;
  size?: number;
  mime?: string;
  location_on_vps?: string;
}

export async function POST(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, admin } = auth.data;

  let body: { files?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  if (!Array.isArray(body.files)) {
    return NextResponse.json(
      { ok: false, error: "files[] richiesto" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const rows = (body.files as IndexedFile[])
    .filter((f) => f && typeof f.name === "string" && f.name.length > 0)
    .slice(0, 500)
    .map((f) => ({
      user_id: userId,
      name: f.name,
      category: typeof f.category === "string" ? f.category : null,
      sha256: typeof f.sha256 === "string" ? f.sha256 : null,
      size: Number.isFinite(f.size) ? f.size : null,
      mime: typeof f.mime === "string" ? f.mime : null,
      location_on_vps:
        typeof f.location_on_vps === "string" ? f.location_on_vps : null,
      updated_at: now,
    }));

  // Upsert (chiave unica user_id+name).
  if (rows.length > 0) {
    const { error: upErr } = await admin
      .from("candidate_files")
      .upsert(rows, { onConflict: "user_id,name" });
    if (upErr) {
      return NextResponse.json(
        { ok: false, error: upErr.message },
        { status: 500 },
      );
    }
  }

  // Delete dei file spariti dal disco. Non serializzare l'intero snapshot in
  // un filtro NOT IN: con centinaia di nomi PostgREST costruisce una URL oltre
  // il limite del proxy e risponde 400 prima di eseguire il DELETE.
  const { data: existing, error: listErr } = await admin
    .from("candidate_files")
    .select("name")
    .eq("user_id", userId);
  if (listErr) {
    return NextResponse.json(
      { ok: false, error: listErr.message },
      { status: 500 },
    );
  }

  const keepNames = new Set(rows.map((r) => r.name));
  const staleNames = (existing ?? [])
    .map((file) => file.name)
    .filter(
      (name): name is string =>
        typeof name === "string" && !keepNames.has(name),
    );
  const DELETE_CHUNK = 50;
  for (let i = 0; i < staleNames.length; i += DELETE_CHUNK) {
    const { error: delErr } = await admin
      .from("candidate_files")
      .delete()
      .eq("user_id", userId)
      .in("name", staleNames.slice(i, i + DELETE_CHUNK));
    if (delErr) {
      return NextResponse.json(
        { ok: false, error: delErr.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, indexed: rows.length });
}
