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

  // Delete dei file spariti dal disco: tutto ciò che non è nello snapshot.
  const keepNames = rows.map((r) => r.name);
  let delQuery = admin.from("candidate_files").delete().eq("user_id", userId);
  if (keepNames.length > 0) {
    // PostgREST: not-in con lista quotata.
    const inList = keepNames.map((n) => `"${n.replace(/"/g, '""')}"`).join(",");
    delQuery = delQuery.not("name", "in", `(${inList})`);
  }
  const { error: delErr } = await delQuery;
  if (delErr) {
    return NextResponse.json(
      { ok: false, error: delErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, indexed: rows.length });
}
