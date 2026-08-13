import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoLegacyId } from "@/lib/demo/data";
import { activeDemoPersona } from "@/lib/demo/mode";
import {
  localFirstWrite,
  type StepResult,
} from "@/lib/positions/local-first-write";
import {
  publicPositionState,
  type PublicPositionState,
} from "@/lib/position-state";

export const dynamic = "force-dynamic";

// O-24 — «mi sono candidato a mano».
//
// Dalla pagina di dettaglio l'utente aveva solo i quattro pulsanti di
// giudizio: se si candidava sul sito dell'azienda, il team non lo sapeva e
// continuava a trattare la posizione come da lavorare — scriveva CV, la
// riproponeva, spendeva token su qualcosa di già fatto.
//
// Il modello c'era già e non veniva raggiunto dal web: `positions.status`
// ammette 'applied' e `applications` ha applied / applied_at / applied_via.
// Da O-73 anche il cloud li scrive insieme tramite RPC: quest'ultimo campo
// distingue CHI ha mandato la candidatura e impedisce al team di rifarla.

/** Chi ha inviato: l'utente a mano, o il team. */
const APPLIED_VIA_USER = "user_manual";

// O-36 — «mi sono candidato» non si annullava.
//
// Un click per sbaglio (o un ripensamento: l'annuncio si apre e non era
// quello) lasciava la posizione 'applied' per sempre, e il team smetteva di
// lavorarci. L'operatore ci è cascato di persona il giorno del rilascio.
//
// A quale stato si torna: a quello REGISTRATO nella transizione che il POST
// ha scritto (from_state). È il dato vero, non una ricostruzione. Solo
// quando manca — box mai sincronizzato, riga potata — si deriva dai fatti
// disponibili, nell'ordine in cui il team li produce.
const FALLBACK_STATE = "scored";

/** Stato plausibile quando la transizione non c'è: CV pronto → 'ready'. */
function derivedPreviousState(hasCv: boolean, hasScore: boolean): string {
  if (hasCv) return "ready";
  if (hasScore) return FALLBACK_STATE;
  return "new";
}

interface AppliedOutcome {
  id: string;
  status: string | null;
  public_state: PublicPositionState;
  applied_at: string | null;
  applied_via: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Il risultato dell'RPC è la verità persistita, non un timestamp inventato. */
function cloudOutcome(data: unknown): AppliedOutcome | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Partial<AppliedOutcome>;
  if (
    typeof value.id !== "string" ||
    typeof value.status !== "string" ||
    typeof value.applied_at !== "string" ||
    typeof value.applied_via !== "string"
  ) {
    return null;
  }
  return {
    ...(value as Omit<AppliedOutcome, "public_state">),
    public_state: publicPositionState(value.status),
  };
}

function cloudUndoOutcome(data: unknown): AppliedOutcome | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Partial<AppliedOutcome>;
  if (
    typeof value.id !== "string" ||
    typeof value.status !== "string" ||
    value.applied_at !== null ||
    value.applied_via !== null
  ) {
    return null;
  }
  return {
    ...(value as Omit<AppliedOutcome, "public_state">),
    public_state: publicPositionState(value.status),
  };
}

function rpcFailure(
  message: string,
  legacyId: number,
): StepResult<AppliedOutcome> {
  if (message.includes("position_not_found")) {
    return {
      ok: false,
      status: 404,
      body: { error: `Posizione #${legacyId} non trovata` },
    };
  }
  if (message.includes("not_applied")) {
    return { ok: false, status: 409, body: { error: "not_applied" } };
  }
  if (message.includes("applied_by_team")) {
    return { ok: false, status: 409, body: { error: "applied_by_team" } };
  }
  console.error(`[positions/mark-applied] RPC failed: ${message}`);
  return { ok: false, status: 500, body: { error: "update_failed" } };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId: legacyIdParam } = await params;

  // [JHT-WEB-DEMO] Le posizioni demo non cambiano stato: dataset statico.
  if (isDemoLegacyId(legacyIdParam) && (await activeDemoPersona())) {
    return NextResponse.json({
      id: `demo-${legacyIdParam}`,
      status: "applied",
      public_state: "applied",
      applied_at: nowIso(),
      applied_via: APPLIED_VIA_USER,
      source: "cloud",
      cloud_synced: null,
    });
  }

  const denied = await requireAuth();
  if (denied) return denied;

  const legacyId = Number.parseInt(legacyIdParam, 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: "legacyId non valido" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { note?: string };
  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

  return localFirstWrite<AppliedOutcome>(req, {
    sessionOnlyError:
      "Solo il browser può segnare una candidatura manuale (no Bearer token)",

    local: (db): StepResult<AppliedOutcome> => {
      const row = db
        .prepare<
          [number],
          { id: number; status: string | null }
        >("SELECT id, status FROM positions WHERE id = ?")
        .get(legacyId);
      if (!row) {
        return {
          ok: false,
          status: 404,
          body: { error: `Posizione #${legacyId} non trovata` },
        };
      }

      const appliedAt = nowIso();
      // Una transazione sola: senza, una posizione può restare 'applied'
      // mentre `applications` non sa di esserlo — e il team leggerebbe due
      // verità diverse sulla stessa candidatura.
      db.transaction(() => {
        // `applied_at` esplicito e mai la stringa 'now': un trigger del DB
        // aborta l'insert se ci arriva il letterale (vedi _db.py).
        db.prepare(
          `INSERT INTO applications
             (position_id, status, applied, applied_at, applied_via, critic_notes)
           VALUES (?, 'applied', 1, ?, ?, ?)
           ON CONFLICT(position_id) DO UPDATE SET
             status      = 'applied',
             applied     = 1,
             applied_at  = excluded.applied_at,
             applied_via = excluded.applied_via,
             updated_at  = CURRENT_TIMESTAMP`,
        ).run(legacyId, appliedAt, APPLIED_VIA_USER, note);

        db.prepare(
          `UPDATE positions SET status = 'applied', last_actor = 'user'
            WHERE id = ?`,
        ).run(legacyId);

        // Stesso event-log che scrive il team sui cambi di stato: da qui la
        // candidatura manuale compare in "Attività recente" come le altre.
        if (row.status !== "applied") {
          db.prepare(
            `INSERT INTO position_state_transitions
               (position_id, from_state, to_state, by_agent, notes)
             VALUES (?, ?, 'applied', 'user', ?)`,
          ).run(legacyId, row.status, note);
        }
      })();

      return {
        ok: true,
        outcome: {
          id: String(legacyId),
          status: "applied",
          public_state: "applied",
          applied_at: appliedAt,
          applied_via: APPLIED_VIA_USER,
        },
      };
    },

    mirror: async (supabase, userId, outcome) => {
      const { error } = await supabase.rpc("mark_position_applied", {
        p_position_legacy_id: legacyId,
        p_applied_at: outcome.applied_at,
        p_applied_via: outcome.applied_via,
        p_note: note,
      });
      if (error) throw new Error(error.message);
      void userId;
    },

    cloud: async (supabase, userId): Promise<StepResult<AppliedOutcome>> => {
      const appliedAt = nowIso();
      const { data, error } = await supabase.rpc("mark_position_applied", {
        p_position_legacy_id: legacyId,
        p_applied_at: appliedAt,
        p_applied_via: APPLIED_VIA_USER,
        p_note: note,
      });
      if (error) {
        return rpcFailure(error.message, legacyId);
      }
      const outcome = cloudOutcome(data);
      if (!outcome)
        return { ok: false, status: 500, body: { error: "invalid_result" } };
      void userId;
      return { ok: true, outcome };
    },
  });
}

// ── Annulla la candidatura manuale (O-36) ──────────────────────────
//
// Due rifiuti espliciti, perché un annullamento silenzioso che annulla la
// cosa sbagliata è peggio del bottone che manca:
//   • se la posizione non è più 'applied', nel frattempo è successo altro
//     (risposta dell'azienda, esclusione) e non tocchiamo niente;
//   • se la candidatura l'ha mandata il TEAM (applied_via ≠ user_manual),
//     annullarla da qui direbbe al team una cosa falsa sul proprio lavoro.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId: legacyIdParam } = await params;

  // [JHT-WEB-DEMO] Le posizioni demo non cambiano stato: dataset statico.
  if (isDemoLegacyId(legacyIdParam) && (await activeDemoPersona())) {
    return NextResponse.json({
      id: `demo-${legacyIdParam}`,
      status: FALLBACK_STATE,
      public_state: publicPositionState(FALLBACK_STATE),
      applied_at: null,
      applied_via: null,
      source: "cloud",
      cloud_synced: null,
    });
  }

  const denied = await requireAuth();
  if (denied) return denied;

  const legacyId = Number.parseInt(legacyIdParam, 10);
  if (!Number.isInteger(legacyId) || legacyId <= 0) {
    return NextResponse.json({ error: "legacyId non valido" }, { status: 400 });
  }

  return localFirstWrite<AppliedOutcome>(req, {
    sessionOnlyError:
      "Solo il browser può annullare una candidatura manuale (no Bearer token)",

    local: (db): StepResult<AppliedOutcome> => {
      const row = db
        .prepare<
          [number],
          { id: number; status: string | null }
        >("SELECT id, status FROM positions WHERE id = ?")
        .get(legacyId);
      if (!row) {
        return {
          ok: false,
          status: 404,
          body: { error: `Posizione #${legacyId} non trovata` },
        };
      }
      if (row.status !== "applied") {
        return {
          ok: false,
          status: 409,
          body: {
            error: "not_applied",
            status: row.status,
          },
        };
      }

      const app = db
        .prepare<
          [number],
          {
            applied_via: string | null;
            cv_path: string | null;
            cv_pdf_path: string | null;
          }
        >(
          "SELECT applied_via, cv_path, cv_pdf_path FROM applications WHERE position_id = ?",
        )
        .get(legacyId);
      if (app && app.applied_via && app.applied_via !== APPLIED_VIA_USER) {
        return {
          ok: false,
          status: 409,
          body: { error: "applied_by_team", applied_via: app.applied_via },
        };
      }

      // Lo stato precedente scritto dal POST. `by_agent = 'user'` perché una
      // transizione verso 'applied' fatta dal team non è quella da annullare.
      const previous = db
        .prepare<[number], { from_state: string | null }>(
          `SELECT from_state FROM position_state_transitions
            WHERE position_id = ? AND to_state = 'applied' AND by_agent = 'user'
            ORDER BY id DESC LIMIT 1`,
        )
        .get(legacyId);
      const hasScore =
        db
          .prepare<
            [number],
            { n: number }
          >("SELECT COUNT(*) AS n FROM scores WHERE position_id = ?")
          .get(legacyId)?.n ?? 0;
      const restored =
        previous?.from_state ??
        derivedPreviousState(
          Boolean(app?.cv_path || app?.cv_pdf_path),
          hasScore > 0,
        );

      // Una transazione sola, come il POST: la posizione e la candidatura non
      // devono poter raccontare due storie diverse.
      db.transaction(() => {
        db.prepare(
          `UPDATE applications
              SET applied = 0, applied_at = NULL, applied_via = NULL,
                  status = CASE WHEN status = 'applied' THEN 'draft' ELSE status END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE position_id = ?`,
        ).run(legacyId);
        db.prepare(
          "UPDATE positions SET status = ?, last_actor = 'user' WHERE id = ?",
        ).run(restored, legacyId);
        db.prepare(
          `INSERT INTO position_state_transitions
             (position_id, from_state, to_state, by_agent, notes)
           VALUES (?, 'applied', ?, 'user', 'annullata dall''utente')`,
        ).run(legacyId, restored);
      })();

      return {
        ok: true,
        outcome: {
          id: String(legacyId),
          status: restored,
          public_state: publicPositionState(restored),
          applied_at: null,
          applied_via: null,
        },
      };
    },

    mirror: async (supabase, userId, outcome) => {
      const { error } = await supabase.rpc("undo_manual_position_application", {
        p_position_legacy_id: legacyId,
        p_restored_status: outcome.status,
      });
      if (error) throw new Error(error.message);
      void userId;
    },

    cloud: async (supabase, userId): Promise<StepResult<AppliedOutcome>> => {
      const { data, error } = await supabase.rpc(
        "undo_manual_position_application",
        { p_position_legacy_id: legacyId, p_restored_status: null },
      );
      if (error) {
        return rpcFailure(error.message, legacyId);
      }
      const outcome = cloudUndoOutcome(data);
      if (!outcome)
        return { ok: false, status: 500, body: { error: "invalid_result" } };
      void userId;
      return { ok: true, outcome };
    },
  });
}
