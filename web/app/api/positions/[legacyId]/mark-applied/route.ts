import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoLegacyId } from "@/lib/demo/data";
import { activeDemoPersona } from "@/lib/demo/mode";
import {
  localFirstWrite,
  type StepResult,
} from "@/lib/positions/local-first-write";

export const dynamic = "force-dynamic";

// O-24 — «mi sono candidato a mano».
//
// Dalla pagina di dettaglio l'utente aveva solo i quattro pulsanti di
// giudizio: se si candidava sul sito dell'azienda, il team non lo sapeva e
// continuava a trattare la posizione come da lavorare — scriveva CV, la
// riproponeva, spendeva token su qualcosa di già fatto.
//
// Nessuna migrazione: il modello c'era già e non veniva raggiunto dal web.
// `positions.status` ammette 'applied' (CHECK in _db.py) e `applications` ha
// applied / applied_at / applied_via. Quest'ultimo è il campo che distingue
// CHI ha mandato la candidatura, ed è l'informazione che serve al team per
// non rifare il lavoro.

/** Chi ha inviato: l'utente a mano, o il team. */
const APPLIED_VIA_USER = "user_manual";

interface AppliedOutcome {
  id: string;
  status: string | null;
  applied_at: string | null;
  applied_via: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
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
          applied_at: appliedAt,
          applied_via: APPLIED_VIA_USER,
        },
      };
    },

    mirror: async (supabase, userId, outcome) => {
      const { error } = await supabase
        .from("positions")
        .update({ status: "applied", last_actor: "user" })
        .eq("user_id", userId)
        .eq("legacy_id", legacyId);
      if (error) throw new Error(error.message);
      void outcome;
    },

    cloud: async (supabase, userId): Promise<StepResult<AppliedOutcome>> => {
      const { data: row, error } = await supabase
        .from("positions")
        .select("status")
        .eq("user_id", userId)
        .eq("legacy_id", legacyId)
        .maybeSingle();
      if (error) {
        console.error(`[positions/mark-applied] 500 ${error.message}`);
        return { ok: false, status: 500, body: { error: "query_failed" } };
      }
      if (!row) {
        return {
          ok: false,
          status: 404,
          body: { error: `Posizione #${legacyId} non trovata` },
        };
      }

      const appliedAt = nowIso();
      const { error: upErr } = await supabase
        .from("positions")
        .update({ status: "applied", last_actor: "user" })
        .eq("user_id", userId)
        .eq("legacy_id", legacyId);
      if (upErr) {
        return {
          ok: false,
          status: 500,
          body: { error: `Supabase update failed: ${upErr.message}` },
        };
      }
      // A box spento `applications` locale non esiste: lo stato torna
      // completo quando il box si risincronizza e vede status='applied'.
      return {
        ok: true,
        outcome: {
          id: String(legacyId),
          status: "applied",
          applied_at: appliedAt,
          applied_via: APPLIED_VIA_USER,
        },
      };
    },
  });
}
