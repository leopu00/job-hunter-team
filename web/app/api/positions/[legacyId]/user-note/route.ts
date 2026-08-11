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

/** La superficie da cui questa route scrive.
 *
 * Il ramo `local` qui sotto scrive nel jobs.db DEL BOX: da O-33 la chiave è
 * `(position_id, origin)` e questa riga è la riga del box, non del sito. La
 * `web` nascerà quando le note avranno una casa sul cloud — oggi quel ramo
 * risponde 503, quindi scrivere `'web'` da qui inventerebbe una provenienza
 * che non esiste e la nota del box tornerebbe non editabile.
 */
const ORIGIN = "box";

/** La tabella può mancare su un jobs.db più vecchio del codice.
 *
 * Nella forma di O-33: se la creasse ancora con la chiave `position_id` la
 * route la farebbe nascere vecchia su un DB nuovo, e la migrazione lato box
 * dovrebbe poi ricrearla — con dentro le note di qualcuno. */
function ensureTable(db: import("better-sqlite3").Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS position_user_notes (
      position_id INTEGER NOT NULL,
      origin TEXT NOT NULL DEFAULT 'box' CHECK (origin IN ('box','web')),
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (position_id, origin),
      FOREIGN KEY (position_id) REFERENCES positions(id)
    );
  `);
}

/** La tabella c'è ma è ancora nella forma pre-O-33?
 *
 * `ensureTable` è un CREATE IF NOT EXISTS: su un jobs.db che ha già la tabella
 * con la vecchia chiave non fa NIENTE, e la colonna `origin` non compare.
 * Quella finestra è reale — fra l'aggiornamento del codice e il primo giro
 * delle migrazioni del box passa del tempo, ed è la finestra in cui O-16 ha
 * già fatto perdere a un utente quello che aveva appena scritto. Qui si
 * guarda com'è fatta la tabella DAVVERO invece di dare per scontata la forma
 * nuova: nella vecchia si scrive alla vecchia maniera e ci pensa la
 * migrazione del box a etichettare la riga come `box`, che è dove è nata. */
function hasOrigin(db: import("better-sqlite3").Database): boolean {
  const cols = db
    .prepare("PRAGMA table_info(position_user_notes)")
    .all() as { name: string }[];
  return cols.some((c) => c.name === "origin");
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

      const keyed = hasOrigin(db);

      if (clearing) {
        // Solo la riga di QUESTA superficie: cancellare dal box una nota
        // scritta sul sito sarebbe cancellare qualcosa che l'utente non ha
        // davanti agli occhi.
        if (keyed) {
          db.prepare(
            "DELETE FROM position_user_notes WHERE position_id = ? AND origin = ?",
          ).run(legacyId, ORIGIN);
        } else {
          db.prepare(
            "DELETE FROM position_user_notes WHERE position_id = ?",
          ).run(legacyId);
        }
        return {
          ok: true,
          outcome: { id: String(legacyId), note: null, updated_at: null },
        };
      }

      if (keyed) {
        db.prepare(
          `INSERT INTO position_user_notes (position_id, origin, body)
           VALUES (?, ?, ?)
           ON CONFLICT(position_id, origin) DO UPDATE SET
             body = excluded.body,
             updated_at = CURRENT_TIMESTAMP`,
        ).run(legacyId, ORIGIN, body);
      } else {
        db.prepare(
          `INSERT INTO position_user_notes (position_id, body)
           VALUES (?, ?)
           ON CONFLICT(position_id) DO UPDATE SET
             body = excluded.body,
             updated_at = CURRENT_TIMESTAMP`,
        ).run(legacyId, body);
      }

      const saved = keyed
        ? db
            .prepare<
              [number, string],
              { body: string; updated_at: string }
            >(
              "SELECT body, updated_at FROM position_user_notes " +
                "WHERE position_id = ? AND origin = ?",
            )
            .get(legacyId, ORIGIN)!
        : db
            .prepare<
              [number],
              { body: string; updated_at: string }
            >(
              "SELECT body, updated_at FROM position_user_notes " +
                "WHERE position_id = ?",
            )
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
