import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoLegacyId } from "@/lib/demo/data";
import { activeDemoPersona } from "@/lib/demo/mode";
import {
  localFirstWrite,
  type StepResult,
} from "@/lib/positions/local-first-write";

export const dynamic = "force-dynamic";

// O-22 — il blocco note PRIVATO dell'utente su una posizione.
//
// «Cose che mi possono essere utili una volta che rivisito la posizione»: un
// promemoria per sé, non un ordine al team. Gli agenti NON la leggono, ed è
// la scelta reversibile delle due — se un giorno la si vorrà condivisa si
// aggiunge, mentre una nota già finita sotto gli occhi del team non si può
// più rendere privata.
//
// Per questo NON tocca `positions.notes`, che è il campo degli agenti: vive
// in `position_user_notes`, tabella separata. C'è anche una seconda ragione,
// meno ovvia e più concreta: `jht cloud restore` fa INSERT OR REPLACE su
// `positions` con un elenco esplicito di colonne, quindi una colonna in più
// verrebbe azzerata a ogni restore. Un campo che perde quello che ci scrivi
// è peggio di un campo che non c'è.

const MAX_NOTE = 4000;

interface NoteOutcome {
  id: string;
  note: string | null;
  updated_at: string | null;
}

/** La tabella può mancare su un jobs.db più vecchio del codice. */
function ensureTable(db: import("better-sqlite3").Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS position_user_notes (
      position_id INTEGER PRIMARY KEY,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (position_id) REFERENCES positions(id)
    );
  `);
}

async function handle(
  req: NextRequest,
  legacyIdParam: string,
  clearing: boolean,
): Promise<NextResponse> {
  if (isDemoLegacyId(legacyIdParam) && (await activeDemoPersona())) {
    return NextResponse.json({
      id: `demo-${legacyIdParam}`,
      note: null,
      updated_at: null,
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

  let body = "";
  if (!clearing) {
    const payload = (await req.json().catch(() => ({}))) as { note?: string };
    body = typeof payload.note === "string" ? payload.note.trim() : "";
    if (!body) {
      return NextResponse.json({ error: "La nota è vuota" }, { status: 400 });
    }
    if (body.length > MAX_NOTE) body = body.slice(0, MAX_NOTE);
  }

  return localFirstWrite<NoteOutcome>(req, {
    sessionOnlyError:
      "Solo il browser può scrivere una nota privata (no Bearer token)",

    local: (db): StepResult<NoteOutcome> => {
      ensureTable(db);
      const exists = db
        .prepare<
          [number],
          { id: number }
        >("SELECT id FROM positions WHERE id = ?")
        .get(legacyId);
      if (!exists) {
        return {
          ok: false,
          status: 404,
          body: { error: `Posizione #${legacyId} non trovata` },
        };
      }

      if (clearing) {
        db.prepare("DELETE FROM position_user_notes WHERE position_id = ?").run(
          legacyId,
        );
        return {
          ok: true,
          outcome: { id: String(legacyId), note: null, updated_at: null },
        };
      }

      db.prepare(
        `INSERT INTO position_user_notes (position_id, body)
         VALUES (?, ?)
         ON CONFLICT(position_id) DO UPDATE SET
           body = excluded.body,
           updated_at = CURRENT_TIMESTAMP`,
      ).run(legacyId, body);

      const saved = db
        .prepare<
          [number],
          { body: string; updated_at: string }
        >("SELECT body, updated_at FROM position_user_notes WHERE position_id = ?")
        .get(legacyId)!;
      return {
        ok: true,
        outcome: {
          id: String(legacyId),
          note: saved.body,
          updated_at: saved.updated_at,
        },
      };
    },

    // Le note oggi si salvano solo dal programma sul computer: sul cloud non
    // esiste ancora dove metterle (O-33 le darà una casa). «Privata» voleva
    // dire privata DAGLI AGENTI — non anche dal cloud: le due cose sono
    // diverse, e confonderle è ciò che ha prodotto questo ramo.
    //
    // Il messaggio dice COSA SUCCEDE, non una causa dedotta — e descrive il
    // mondo che ESISTE: la nota è stata mergiata un'ora dopo il tag della
    // v0.3.7, quindi oggi non è né sul web né nell'app installata. Dire
    // «salvala dall'app» manderebbe a cercarla dove non c'è.
    // Va riletto a ogni release che sposta la funzione (vedi UserNote.tsx).
    cloud: async (): Promise<StepResult<NoteOutcome>> => ({
      ok: false,
      status: 503,
      body: {
        error:
          "Le note non sono ancora disponibili: arrivano con il prossimo aggiornamento.",
      },
    }),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  return handle(req, legacyId, false);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const { legacyId } = await params;
  return handle(req, legacyId, true);
}
