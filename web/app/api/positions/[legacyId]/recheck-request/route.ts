import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import Database from "better-sqlite3";
import fs from "fs";
import { resolveUser } from "@/lib/team-state/auth";
import { requireAuth } from "@/lib/auth";
import {
  LOCAL_TOKEN_COOKIE,
  isLocalTokenAuthenticated,
} from "@/lib/local-token";
import { JHT_DB_PATH } from "@/lib/jht-paths";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// Recheck/liveness ON-DEMAND (2026-06-18). Il recheck NON è più autonomo:
// l'utente clicca "Ricontrolla se attiva" sulla pagina dettaglio → questa route
// setta positions.recheck_requested = 1; l'Analista serve la coda
// next-for-recheck (flag-driven) e ri-verifica la liveness. "Servito" =
// last_open_check aggiornato dopo recheck_requested_at → la posizione esce dalla
// coda senza azzerare il flag (una nuova richiesta aggiorna il timestamp).
//
// Stesso doppio path di write-request/geocode-request:
//   A) SQLite locale source-of-truth (+ best-effort cloud)
//   B) cloud-only (container offline) → applicato al boot via pull-desired-state.

async function handleToggle(
  req: NextRequest,
  legacyIdParam: string,
  requested: boolean,
): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  const legacyId = Number.parseInt(legacyIdParam, 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: "legacyId non valido" }, { status: 400 });
  }

  // [JHT-DASHBOARD-NATIVE] Desktop nativo: con un local-token valido scrivi
  // SOLO su SQLite locale (source-of-truth) e ritorna, senza passare dal cloud
  // (resolveUser→Supabase, che rifiuterebbe il Bearer local-token). La route
  // resta cloud-session per il browser web.
  if (
    isLocalTokenAuthenticated(
      req.headers.get("authorization"),
      (await cookies()).get(LOCAL_TOKEN_COOKIE)?.value,
    )
  ) {
    if (!fs.existsSync(JHT_DB_PATH)) {
      return NextResponse.json({ error: "DB locale assente" }, { status: 503 });
    }
    const db = new Database(JHT_DB_PATH);
    try {
      db.pragma("journal_mode = WAL");
      const row = db
        .prepare<[number], { id: number }>(
          "SELECT id FROM positions WHERE id = ?",
        )
        .get(legacyId);
      if (!row) {
        return NextResponse.json(
          { error: `Posizione #${legacyId} non trovata` },
          { status: 404 },
        );
      }
      db.prepare(
        `UPDATE positions
            SET recheck_requested = ?,
                recheck_requested_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE recheck_requested_at END
          WHERE id = ?`,
      ).run(requested ? 1 : 0, requested ? 1 : 0, legacyId);
    } finally {
      db.close();
    }
    return NextResponse.json({ recheck_requested: requested, local: true });
  }

  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser può richiedere il recheck (no Bearer token)" },
      { status: 403 },
    );
  }
  const { userId, supabase } = resolved.user;

  const hasLocal = fs.existsSync(JHT_DB_PATH);

  if (hasLocal) {
    const db = new Database(JHT_DB_PATH);
    try {
      db.pragma("journal_mode = WAL");
      const row = db
        .prepare<[number], { id: number }>(
          "SELECT id FROM positions WHERE id = ?",
        )
        .get(legacyId);
      if (!row) {
        return NextResponse.json(
          { error: `Posizione #${legacyId} non trovata` },
          { status: 404 },
        );
      }
      db.prepare(
        `UPDATE positions
            SET recheck_requested = ?,
                recheck_requested_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE recheck_requested_at END
          WHERE id = ?`,
      ).run(requested ? 1 : 0, requested ? 1 : 0, legacyId);
    } finally {
      db.close();
    }
    // Best-effort cloud (SQLite resta source-of-truth in-process).
    let cloudOk: boolean | null = null;
    try {
      const { error } = await supabase
        .from("positions")
        .update({
          recheck_requested: requested,
          ...(requested
            ? { recheck_requested_at: new Date().toISOString() }
            : {}),
        })
        .eq("user_id", userId)
        .eq("legacy_id", legacyId);
      cloudOk = !error;
    } catch {
      cloudOk = false;
    }
    return NextResponse.json({
      id: String(legacyId),
      recheck_requested: requested,
      cloud_synced: cloudOk,
      source: "local",
    });
  }

  // Cloud-mode: il container applica al boot via pull-desired-state.
  const { data: row, error } = await supabase
    .from("positions")
    .select("id")
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .maybeSingle();
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "positions/[legacyId]/recheck-request",
      publicMessage: "query_failed",
    });
  }
  if (!row) {
    return NextResponse.json(
      { error: `Posizione #${legacyId} non trovata` },
      { status: 404 },
    );
  }
  const { error: upErr } = await supabase
    .from("positions")
    .update({
      recheck_requested: requested,
      recheck_requested_at: requested ? new Date().toISOString() : null,
    })
    .eq("user_id", userId)
    .eq("legacy_id", legacyId);
  if (upErr) {
    return NextResponse.json(
      { error: `Supabase update failed: ${upErr.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({
    id: String(legacyId),
    recheck_requested: requested,
    cloud_synced: true,
    source: "cloud",
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  return handleToggle(req, legacyId, true);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  return handleToggle(req, legacyId, false);
}
