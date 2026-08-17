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
import {
  FIRST_INTERVIEW_ROUND,
  isDeclarableOutcome,
  type DeclarableOutcome,
} from "@/lib/applications/outcome";

export const dynamic = "force-dynamic";

// O-102 / #187 — «l'hanno respinta» e «vogliono un colloquio».
//
// Dopo O-24 l'utente poteva dire di essersi candidato, e lì la storia si
// fermava: com'è andata non aveva dove finire. Il campo però c'era da sempre
// (`applications.response`) e aveva già un lettore — il Mentor, che ci calcola
// i tassi del suo Pattern D. Non mancava il dato: mancava chi lo scrivesse.
// In produzione: 0 righe valorizzate su 428, contro 8 posizioni già passate
// per lo stato `response`.
//
// Cosa cambia un esito, e cosa NO: alimenta le statistiche del Mentor, e
// basta. Decisione dell'operatore del 17/08, testuale — «resta solo
// statistica»: un «respinto» non ri-mira la ricerca e non tocca le priorità
// del Capitano. Sta scritto qui perché fra un mese sembrerà una dimenticanza.
//
// ⚠️ In modalità CLOUD questo non arriva al team finché `applications` non
// scende nel pull dello stato desiderato (#186): il verso macchina → cloud
// funziona, quello opposto no. Il ramo locale invece è completo.

interface OutcomeResult {
  id: string;
  status: string | null;
  public_state: PublicPositionState;
  response: string | null;
  response_at: string | null;
  interview_round: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rpcFailure(
  message: string,
  legacyId: number,
): StepResult<OutcomeResult> {
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
  if (message.includes("no_outcome")) {
    return { ok: false, status: 409, body: { error: "no_outcome" } };
  }
  if (message.includes("invalid_outcome")) {
    return { ok: false, status: 400, body: { error: "invalid_outcome" } };
  }
  console.error(`[positions/outcome] RPC failed: ${message}`);
  return { ok: false, status: 500, body: { error: "update_failed" } };
}

function cloudOutcome(data: unknown): OutcomeResult | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Partial<OutcomeResult>;
  if (typeof value.id !== "string" || typeof value.status !== "string") {
    return null;
  }
  return {
    id: value.id,
    status: value.status,
    public_state: publicPositionState(value.status),
    response: value.response ?? null,
    response_at: value.response_at ?? null,
    interview_round: value.interview_round ?? null,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId: legacyIdParam } = await params;
  const body = (await req.json().catch(() => ({}))) as { outcome?: unknown };

  // Il vocabolario si controlla PRIMA di qualunque ramo, demo compresa: un
  // esito inventato non deve poter tornare indietro come se fosse valido
  // nemmeno dal dataset finto, o la UI imparerebbe a fidarsi di un valore che
  // il database rifiuterebbe.
  if (!isDeclarableOutcome(body.outcome)) {
    return NextResponse.json({ error: "invalid_outcome" }, { status: 400 });
  }
  const outcome: DeclarableOutcome = body.outcome;

  // [JHT-WEB-DEMO] Le posizioni demo non cambiano stato: dataset statico.
  if (isDemoLegacyId(legacyIdParam) && (await activeDemoPersona())) {
    return NextResponse.json({
      id: `demo-${legacyIdParam}`,
      status: "response",
      public_state: "response",
      response: outcome,
      response_at: nowIso(),
      interview_round: outcome === "interview" ? FIRST_INTERVIEW_ROUND : null,
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

  return localFirstWrite<OutcomeResult>(req, {
    sessionOnlyError:
      "Solo il browser può dichiarare l'esito di una candidatura (no Bearer token)",

    local: (db): StepResult<OutcomeResult> => {
      const position = db
        .prepare<
          [number],
          { id: number; status: string | null }
        >("SELECT id, status FROM positions WHERE id = ?")
        .get(legacyId);
      if (!position) {
        return {
          ok: false,
          status: 404,
          body: { error: `Posizione #${legacyId} non trovata` },
        };
      }

      const application = db
        .prepare<
          [number],
          { applied: number | null; interview_round: number | null }
        >("SELECT applied, interview_round FROM applications WHERE position_id = ?")
        .get(legacyId);
      // L'esito è la progressione dell'invio: senza invio non è un esito, è
      // un errore. Stessa regola della CLI (`db_update.py application`).
      if (!application || !application.applied) {
        return { ok: false, status: 409, body: { error: "not_applied" } };
      }

      const responseAt = nowIso();
      const round =
        outcome === "interview"
          ? (application.interview_round ?? FIRST_INTERVIEW_ROUND)
          : application.interview_round;

      // Una transazione sola, come il POST di mark-applied: la posizione e la
      // candidatura non devono poter raccontare due storie diverse — è
      // esattamente così che sono nate le 8 righe mute in produzione.
      db.transaction(() => {
        db.prepare(
          `UPDATE applications
              SET status = 'response',
                  response = ?,
                  response_at = ?,
                  interview_round = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE position_id = ?`,
        ).run(outcome, responseAt, round ?? null, legacyId);

        db.prepare(
          `UPDATE positions SET status = 'response', last_actor = 'user'
            WHERE id = ?`,
        ).run(legacyId);

        if (position.status !== "response") {
          db.prepare(
            `INSERT INTO position_state_transitions
               (position_id, from_state, to_state, by_agent, notes)
             VALUES (?, ?, 'response', 'user', ?)`,
          ).run(legacyId, position.status, outcome);
        }
      })();

      return {
        ok: true,
        outcome: {
          id: String(legacyId),
          status: "response",
          public_state: "response",
          response: outcome,
          response_at: responseAt,
          interview_round: round ?? null,
        },
      };
    },

    mirror: async (supabase, userId, result) => {
      const { error } = await supabase.rpc("mark_position_outcome", {
        p_position_legacy_id: legacyId,
        p_outcome: outcome,
        p_response_at: result.response_at,
      });
      if (error) throw new Error(error.message);
      void userId;
    },

    cloud: async (supabase, userId): Promise<StepResult<OutcomeResult>> => {
      const { data, error } = await supabase.rpc("mark_position_outcome", {
        p_position_legacy_id: legacyId,
        p_outcome: outcome,
        p_response_at: nowIso(),
      });
      if (error) return rpcFailure(error.message, legacyId);
      const result = cloudOutcome(data);
      if (!result)
        return { ok: false, status: 500, body: { error: "invalid_result" } };
      void userId;
      return { ok: true, outcome: result };
    },
  });
}

// ── Annulla l'esito ────────────────────────────────────────────────────
//
// Esiste per la stessa ragione dell'undo dell'invio (O-36): un click per
// sbaglio che non si annulla è peggio del bottone che manca, e l'operatore ci
// è cascato di persona il giorno del rilascio.
//
// Si torna a `applied` e non più indietro: la candidatura è stata mandata
// davvero, e quel fatto non lo cancella un ripensamento sull'esito.
export async function DELETE(
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
      response: null,
      response_at: null,
      interview_round: null,
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

  return localFirstWrite<OutcomeResult>(req, {
    sessionOnlyError:
      "Solo il browser può annullare l'esito di una candidatura (no Bearer token)",

    local: (db): StepResult<OutcomeResult> => {
      const position = db
        .prepare<
          [number],
          { id: number; status: string | null }
        >("SELECT id, status FROM positions WHERE id = ?")
        .get(legacyId);
      if (!position) {
        return {
          ok: false,
          status: 404,
          body: { error: `Posizione #${legacyId} non trovata` },
        };
      }

      const application = db
        .prepare<
          [number],
          { response: string | null; interview_round: number | null }
        >("SELECT response, interview_round FROM applications WHERE position_id = ?")
        .get(legacyId);
      if (!application || !application.response) {
        return { ok: false, status: 409, body: { error: "no_outcome" } };
      }

      // Un round oltre il primo l'ha scritto il team dalla CLI: non è roba di
      // questo bottone e non si cancella qui.
      const keptRound =
        application.interview_round === FIRST_INTERVIEW_ROUND
          ? null
          : application.interview_round;

      db.transaction(() => {
        db.prepare(
          `UPDATE applications
              SET status = 'applied',
                  response = NULL,
                  response_at = NULL,
                  interview_round = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE position_id = ?`,
        ).run(keptRound, legacyId);

        db.prepare(
          "UPDATE positions SET status = 'applied', last_actor = 'user' WHERE id = ?",
        ).run(legacyId);

        if (position.status !== "applied") {
          db.prepare(
            `INSERT INTO position_state_transitions
               (position_id, from_state, to_state, by_agent, notes)
             VALUES (?, ?, 'applied', 'user', 'esito annullato dall''utente')`,
          ).run(legacyId, position.status);
        }
      })();

      return {
        ok: true,
        outcome: {
          id: String(legacyId),
          status: "applied",
          public_state: "applied",
          response: null,
          response_at: null,
          interview_round: keptRound,
        },
      };
    },

    mirror: async (supabase, userId) => {
      const { error } = await supabase.rpc("undo_position_outcome", {
        p_position_legacy_id: legacyId,
      });
      if (error) throw new Error(error.message);
      void userId;
    },

    cloud: async (supabase, userId): Promise<StepResult<OutcomeResult>> => {
      const { data, error } = await supabase.rpc("undo_position_outcome", {
        p_position_legacy_id: legacyId,
      });
      if (error) return rpcFailure(error.message, legacyId);
      const result = cloudOutcome(data);
      if (!result)
        return { ok: false, status: 500, body: { error: "invalid_result" } };
      void userId;
      return { ok: true, outcome: result };
    },
  });
}
