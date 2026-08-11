import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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

/** Le due superfici da cui questa route scrive — una per ramo.
 *
 * `origin` è LA SUPERFICIE CHE SCRIVE, non la UI, ed è in chiave perché
 * quando i due testi divergono si tengono ENTRAMBI. Il ramo `local` scrive
 * nel jobs.db DEL BOX, quindi la sua riga è `'box'` anche quando l'utente sta
 * usando il sito: a box acceso è SQLite la source of truth in-process, e
 * marcarla `'web'` renderebbe la nota del box non più editabile da qui.
 *
 * Il ramo `cloud` (box spento, mig 069) scrive sul cloud, dove la superficie
 * è il sito: `'web'`. Sono le due sole combinazioni che questa route produce.
 */
const ORIGIN_BOX = "box";
const ORIGIN_WEB = "web";

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

/** Ramo cloud: box spento, la nota vive su `public.position_user_notes`
 * (mig 069) nella riga `origin = 'web'`.
 *
 * Il `legacyId` che arriva dall'URL è l'id SQLite del box; sul cloud le FK
 * sono uuid, quindi la posizione va prima ritrovata fra le righe dell'utente —
 * stesso lookup di ../user-exclude/route.ts. Il filtro su `user_id` non è
 * ridondante con la RLS: `legacy_id` è un contatore per-box, quindi senza di
 * esso la stessa query potrebbe indicare la posizione di un altro utente e la
 * RLS la nasconderebbe soltanto, restituendo un 404 dove il difetto è nella
 * query.
 *
 * La posizione mancante è un 404, non un 500: può semplicemente non essere
 * ancora salita sul cloud (push del box in ritardo, o box che non ha mai
 * sincronizzato), ed è un fatto normale — non un guasto. */
async function applyCloud(
  supabase: SupabaseClient,
  userId: string,
  legacyId: number,
  clearing: boolean,
  body: string,
): Promise<StepResult<NoteOutcome>> {
  const { data: pos, error } = await supabase
    .from("positions")
    .select("id")
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .maybeSingle();
  if (error) {
    // Helper che ritorna un BODY, non una NextResponse: `sanitizedError` non
    // è applicabile, quindi ne replichiamo il contratto a mano.
    console.error(`[positions/user-note] 500 ${error.message}`);
    return { ok: false, status: 500, body: { error: "query_failed" } };
  }
  if (!pos) {
    return {
      ok: false,
      status: 404,
      body: { error: `Posizione #${legacyId} non trovata` },
    };
  }
  const positionId = (pos as { id: string }).id;

  if (clearing) {
    // Solo la riga di QUESTA superficie, come nel ramo local: cancellare la
    // riga 'box' significherebbe cancellare un testo che l'utente non ha
    // davanti agli occhi.
    const { error: delErr } = await supabase
      .from("position_user_notes")
      .delete()
      .eq("user_id", userId)
      .eq("position_id", positionId)
      .eq("origin", ORIGIN_WEB);
    if (delErr) {
      return {
        ok: false,
        status: 500,
        body: { error: `Supabase delete failed: ${delErr.message}` },
      };
    }
    return {
      ok: true,
      outcome: { id: String(legacyId), note: null, updated_at: null },
    };
  }

  // `onConflict` sulla chiave COMPLETA: dichiararlo sulle sole
  // (user_id, position_id) non è un upsert che si comporta male, è un errore —
  // non esiste un vincolo unico su quella coppia. `updated_at` lo muove il
  // trigger della migration, non chi scrive.
  const { data: saved, error: upErr } = await supabase
    .from("position_user_notes")
    .upsert(
      { user_id: userId, position_id: positionId, origin: ORIGIN_WEB, body },
      { onConflict: "user_id,position_id,origin" },
    )
    .select("body, updated_at")
    .single();
  if (upErr || !saved) {
    return {
      ok: false,
      status: 500,
      body: {
        error: `Supabase upsert failed: ${upErr?.message ?? "nessuna riga"}`,
      },
    };
  }
  const row = saved as { body: string; updated_at: string | null };
  return {
    ok: true,
    outcome: {
      id: String(legacyId),
      note: row.body,
      updated_at: row.updated_at,
    },
  };
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
          ).run(legacyId, ORIGIN_BOX);
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
        ).run(legacyId, ORIGIN_BOX, body);
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
            .get(legacyId, ORIGIN_BOX)!
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

    // Box spento: il cloud è l'unica sorgente, e da O-33 (mig 069) ce n'è
    // una. Questo ramo rispondeva 503 «non esiste ancora dove metterle»:
    // «privata» voleva dire privata DAGLI AGENTI — non anche dal cloud, e
    // confondere le due cose è ciò che aveva prodotto quel 503. Gli agenti
    // non la leggono perché non sta in `positions.notes`, non perché non si
    // sincronizza.
    //
    // Nessun `mirror`: a box acceso la nota resta nel jobs.db e non sale sul
    // cloud. È deliberato per ora — un mirror porterebbe qui la riga 'box' e
    // il lettore dovrebbe scegliere quale delle due mostrare in un pannello
    // che ha un solo textarea. La tabella cloud ha già `origin` in chiave,
    // quindi quel pezzo si aggiunge senza ri-migrare.
    cloud: (supabase, userId) => applyCloud(supabase, userId, legacyId, clearing, body),
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
