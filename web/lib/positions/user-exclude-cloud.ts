import type { SupabaseClient } from "@supabase/supabase-js";

// Esclusione manuale su Supabase, con il client che si ha: la sessione
// dell'utente (RLS) nel web cloud e nella desktop. Estratto da
// app/api/positions/[legacyId]/user-exclude/route.ts, che lo usa per il
// ramo cloud della sua scrittura local-first; qui niente Next, SQLite o fs,
// così la desktop lo importa senza portarsi dietro il server.

export interface ExcludeOutcome {
  id: string;
  status: string | null;
  user_excluded_reason: string | null;
  /** Stato da ripristinare con undo; serve anche al mirror cloud. */
  user_excluded_prev_status: string | null;
}

/** Stessa forma di `StepResult<ExcludeOutcome>` di local-first-write. */
export type ExcludeStepResult =
  | { ok: true; outcome: ExcludeOutcome }
  | { ok: false; status: number; body: Record<string, unknown> };

// ── Path B: Supabase unica source (cloud-mode) ─────────────────────
export async function applyCloud(
  supabase: SupabaseClient,
  userId: string,
  legacyId: number,
  action: "exclude" | "unexclude",
  reason?: string,
  note?: string,
): Promise<ExcludeStepResult> {
  const { data: row, error } = await supabase
    .from("positions")
    .select("status, user_excluded_prev_status")
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .maybeSingle();
  if (error) {
    // Helper che ritorna un BODY, non una NextResponse: `sanitizedError` non
    // è applicabile, quindi ne replichiamo il contratto a mano.
    console.error(`[positions/user-exclude] 500 ${error.message}`);
    return { ok: false, status: 500, body: { error: "query_failed" } };
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
  if (action === "exclude") {
    const prev =
      r.status === "excluded"
        ? (r.user_excluded_prev_status ?? "scored")
        : r.status;
    nextStatus = "excluded";
    update = {
      status: "excluded",
      user_excluded_reason: reason,
      user_excluded_note: note ?? null,
      user_excluded_at: new Date().toISOString(),
      user_excluded_prev_status: prev,
      last_actor: "user",
    };
  } else {
    nextStatus = r.user_excluded_prev_status ?? "scored";
    update = {
      status: nextStatus,
      user_excluded_reason: null,
      user_excluded_note: null,
      user_excluded_at: null,
      user_excluded_prev_status: null,
      last_actor: "user",
    };
  }

  const { data: updated, error: upErr } = await supabase
    .from("positions")
    .update(update)
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .select("status, user_excluded_reason, user_excluded_prev_status")
    .maybeSingle();
  if (upErr) {
    return {
      ok: false,
      status: 500,
      body: { error: `Supabase update failed: ${upErr.message}` },
    };
  }
  if (!updated) {
    return {
      ok: false,
      status: 404,
      body: { error: `Posizione #${legacyId} non trovata` },
    };
  }
  const saved = updated as {
    status: string | null;
    user_excluded_reason: string | null;
    user_excluded_prev_status: string | null;
  };
  return {
    ok: true,
    outcome: {
      id: String(legacyId),
      status: saved.status,
      user_excluded_reason: saved.user_excluded_reason,
      user_excluded_prev_status: saved.user_excluded_prev_status,
    },
  };
}
