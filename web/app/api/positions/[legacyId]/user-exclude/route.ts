import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "fs";
import { resolveUser } from "@/lib/team-state/auth";
import { JHT_DB_PATH } from "@/lib/jht-paths";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Esclusione MANUALE di una posizione da parte dell'utente, dalla pagina
// dettaglio. L'utente sceglie una causa (5 default + 'Altro' con testo libero).
//
// Effetto: status -> 'excluded'. La posizione esce dalle code agenti
// (next-for-recheck / next-for-categorize filtrano già lo stato) → gli agenti
// NON sprecano token a ri-verificarne la liveness: lo decide l'utente.
// Reversibile: `user_excluded_prev_status` conserva lo stato precedente, così
// DELETE lo ripristina.
//
// Due path operativi come write-request (decisi dalla presenza di SQLite):
//   A) Local mode: UPDATE atomico su SQLite (source of truth in-process per il
//      team), poi best-effort UPDATE Supabase per la UI cross-device.
//   B) Cloud mode (container offline): UPDATE solo su Supabase; lo 'status'
//      rientra al boot via il push/pull esistente.
// Vedi pattern in write-request/route.ts + migration 041_positions_user_excluded.

const VALID_REASONS = new Set([
  "closed", // Chiusa / non più attiva
  "not_interested", // Non mi interessa
  "already_applied", // Già candidato / gestita altrove
  "company", // Azienda non desiderata
  "conditions", // Condizioni inadatte (stipendio/sede)
  "other", // Altro (richiede note)
]);

interface ExcludeOutcome {
  id: string;
  status: string | null;
  user_excluded_reason: string | null;
  source: "local" | "cloud";
  cloud_synced: boolean | null;
}

type ApplyResult =
  | { ok: true; outcome: ExcludeOutcome }
  | { ok: false; status: number; body: Record<string, unknown> };

// ── Path A: SQLite locale source of truth ──────────────────────────
function applyLocal(
  legacyId: number,
  action: "exclude" | "unexclude",
  reason?: string,
  note?: string,
): ApplyResult {
  const db = new Database(JHT_DB_PATH);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const row = db
      .prepare<
        [number],
        {
          id: number;
          status: string | null;
          user_excluded_prev_status: string | null;
        }
      >(
        "SELECT id, status, user_excluded_prev_status FROM positions WHERE id = ?",
      )
      .get(legacyId);
    if (!row) {
      return {
        ok: false,
        status: 404,
        body: { error: `Posizione #${legacyId} non trovata` },
      };
    }

    if (action === "exclude") {
      // Conserva lo stato attuale come prev SOLO se non è già un'esclusione
      // utente in corso (evita di perdere il vero stato pre-esclusione).
      const prev =
        row.status === "excluded"
          ? (row.user_excluded_prev_status ?? "scored")
          : row.status;
      db.prepare(
        `UPDATE positions
            SET status = 'excluded',
                user_excluded_reason = ?,
                user_excluded_note = ?,
                user_excluded_at = CURRENT_TIMESTAMP,
                user_excluded_prev_status = ?
          WHERE id = ?`,
      ).run(reason!, note ?? null, prev, legacyId);
    } else {
      const restore = row.user_excluded_prev_status ?? "scored";
      db.prepare(
        `UPDATE positions
            SET status = ?,
                user_excluded_reason = NULL,
                user_excluded_note = NULL,
                user_excluded_at = NULL,
                user_excluded_prev_status = NULL
          WHERE id = ?`,
      ).run(restore, legacyId);
    }

    const updated = db
      .prepare<
        [number],
        { status: string | null; user_excluded_reason: string | null }
      >("SELECT status, user_excluded_reason FROM positions WHERE id = ?")
      .get(legacyId)!;

    return {
      ok: true,
      outcome: {
        id: String(legacyId),
        status: updated.status,
        user_excluded_reason: updated.user_excluded_reason,
        source: "local",
        cloud_synced: null,
      },
    };
  } finally {
    db.close();
  }
}

// ── Path B: Supabase unica source (cloud-mode) ─────────────────────
async function applyCloud(
  supabase: SupabaseClient,
  userId: string,
  legacyId: number,
  action: "exclude" | "unexclude",
  reason?: string,
  note?: string,
): Promise<ApplyResult> {
  const { data: row, error } = await supabase
    .from("positions")
    .select("status, user_excluded_prev_status")
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      body: { error: `Supabase query failed: ${error.message}` },
    };
  }
  if (!row) {
    return {
      ok: false,
      status: 404,
      body: { error: `Posizione #${legacyId} non trovata` },
    };
  }
  const r = row as {
    status: string | null;
    user_excluded_prev_status: string | null;
  };

  let update: Record<string, unknown>;
  let nextStatus: string | null;
  let nextReason: string | null;
  if (action === "exclude") {
    const prev =
      r.status === "excluded"
        ? (r.user_excluded_prev_status ?? "scored")
        : r.status;
    nextStatus = "excluded";
    nextReason = reason ?? null;
    update = {
      status: "excluded",
      user_excluded_reason: reason,
      user_excluded_note: note ?? null,
      user_excluded_at: new Date().toISOString(),
      user_excluded_prev_status: prev,
    };
  } else {
    nextStatus = r.user_excluded_prev_status ?? "scored";
    nextReason = null;
    update = {
      status: nextStatus,
      user_excluded_reason: null,
      user_excluded_note: null,
      user_excluded_at: null,
      user_excluded_prev_status: null,
    };
  }

  const { error: upErr } = await supabase
    .from("positions")
    .update(update)
    .eq("user_id", userId)
    .eq("legacy_id", legacyId);
  if (upErr) {
    return {
      ok: false,
      status: 500,
      body: { error: `Supabase update failed: ${upErr.message}` },
    };
  }
  return {
    ok: true,
    outcome: {
      id: String(legacyId),
      status: nextStatus,
      user_excluded_reason: nextReason,
      source: "cloud",
      cloud_synced: true,
    },
  };
}

async function handle(
  req: NextRequest,
  legacyIdParam: string,
  action: "exclude" | "unexclude",
): Promise<NextResponse> {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser può escludere manualmente (no Bearer token)" },
      { status: 403 },
    );
  }
  const { userId, supabase } = resolved.user;

  const legacyId = Number.parseInt(legacyIdParam, 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: "legacyId non valido" }, { status: 400 });
  }

  let reason: string | undefined;
  let note: string | undefined;
  if (action === "exclude") {
    const body = (await req.json().catch(() => ({}))) as {
      reason?: string;
      note?: string;
    };
    reason = body.reason;
    note =
      typeof body.note === "string"
        ? body.note.trim().slice(0, 500)
        : undefined;
    if (!reason || !VALID_REASONS.has(reason)) {
      return NextResponse.json(
        { error: `Causa non valida: '${reason ?? ""}'` },
        { status: 400 },
      );
    }
    if (reason === "other" && !note) {
      return NextResponse.json(
        { error: "Per 'Altro' serve un testo che spieghi la causa" },
        { status: 400 },
      );
    }
  }

  const hasLocal = fs.existsSync(JHT_DB_PATH);

  if (hasLocal) {
    const local = applyLocal(legacyId, action, reason, note);
    if (!local.ok)
      return NextResponse.json(local.body, { status: local.status });
    // Best-effort cloud write (single source-of-truth in-process = SQLite).
    let cloudOk: boolean | null = null;
    try {
      const update =
        action === "exclude"
          ? {
              status: "excluded",
              user_excluded_reason: reason,
              user_excluded_note: note ?? null,
              user_excluded_at: new Date().toISOString(),
            }
          : {
              // Allinea anche lo status (= quello ripristinato in locale), così
              // il cloud esce subito da 'excluded' senza attendere il push.
              status: local.outcome.status,
              user_excluded_reason: null,
              user_excluded_note: null,
              user_excluded_at: null,
              user_excluded_prev_status: null,
            };
      const { error } = await supabase
        .from("positions")
        .update(update)
        .eq("user_id", userId)
        .eq("legacy_id", legacyId);
      cloudOk = !error;
    } catch {
      cloudOk = false;
    }
    return NextResponse.json({ ...local.outcome, cloud_synced: cloudOk });
  }

  const cloud = await applyCloud(
    supabase,
    userId,
    legacyId,
    action,
    reason,
    note,
  );
  if (!cloud.ok) return NextResponse.json(cloud.body, { status: cloud.status });
  return NextResponse.json(cloud.outcome);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  return handle(req, legacyId, "exclude");
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  return handle(req, legacyId, "unexclude");
}
