/**
 * #186 — la candidatura decisa sul web torna alla macchina.
 *
 * Il click su «mi sono candidato» in cloud-mode scrive solo su Supabase. Il
 * verso di ritorno esisteva gia' — `pull-desired-state` porta a casa i flag
 * CV/geocode/recheck e l'esclusione utente — ma non ha mai portato la
 * candidatura: misurato su una VPS, 19 posizioni `applied` sul cloud e 2 sul
 * box. Non e' un difetto di vista: il team LEGGE quella tabella, quindi
 * pianificava e consigliava su due righe invece di venti.
 *
 * Sta in un modulo suo, e non dentro `handlePullDesiredState`, per la stessa
 * ragione di `halt-gate.js`: la decisione si prova senza rete, senza config e
 * senza importare il grafo di `cloud.js`. Qui dentro ci sono solo le
 * scritture; il giudizio vive in `shared/cloud/applied-action.js`, dove lo
 * legge anche la route che scrive la candidatura.
 *
 * Compatibile con `node:sqlite` (il daemon) e con `better-sqlite3` (i test):
 * niente `db.transaction()`, che esiste solo nel secondo — le transazioni si
 * aprono con `exec('BEGIN')`, che entrambi hanno.
 */
import {
  APPLIED_VIA_USER,
  decideAppliedBackflow,
  decideOutcomeBackflow,
  derivedPreviousState,
} from "../../../shared/cloud/applied-action.js";

/** Lo stato locale che serve a decidere, in una lettura sola. */
const LOCAL_SQL = `
  SELECT p.status        AS status,
         a.applied       AS applied,
         a.applied_via   AS applied_via,
         a.response      AS response,
         a.response_at   AS response_at,
         a.cv_path       AS cv_path,
         a.cv_pdf_path   AS cv_pdf_path,
         (SELECT COUNT(*) FROM scores s WHERE s.position_id = p.id) AS n_scores
    FROM positions p
    LEFT JOIN applications a ON a.position_id = p.id
   WHERE p.id = ?
`;

// La riga `applications` la scriviamo con lo stesso statement della route che
// serve il click locale (`mark-applied`): stessa ON CONFLICT, stessi campi.
// `applied_at` arriva sempre valorizzato dal cloud e mai come letterale
// 'now' — un trigger di `_db.py` aborta l'INSERT se ci trova quella stringa.
const UPSERT_APPLICATION_SQL = `
  INSERT INTO applications
    (position_id, status, applied, applied_at, applied_via)
  VALUES (?, 'applied', 1, ?, ?)
  ON CONFLICT(position_id) DO UPDATE SET
    status      = 'applied',
    applied     = 1,
    applied_at  = excluded.applied_at,
    applied_via = excluded.applied_via,
    updated_at  = CURRENT_TIMESTAMP
`;

// L'esito (#187): due colonne e lo stato che ne consegue. Non tocca
// `applied`/`applied_at` — l'esito non e' un secondo invio, e' cosa e'
// successo dopo — ne' `interview_round`, che il round lo scrive chi lo
// conosce (il team dalla CLI) e portarlo qui allargherebbe il perimetro di
// una riparazione che deve arrivare prima di quella di O-97.
const WRITE_OUTCOME_SQL = `
  UPDATE applications
     SET status      = 'response',
         response    = ?,
         response_at = ?,
         updated_at  = CURRENT_TIMESTAMP
   WHERE position_id = ?
`;

const CLEAR_APPLICATION_SQL = `
  UPDATE applications
     SET applied = 0, applied_at = NULL, applied_via = NULL,
         status = CASE WHEN status = 'applied' THEN 'draft' ELSE status END,
         updated_at = CURRENT_TIMESTAMP
   WHERE position_id = ?
`;

// Lo stato da cui la candidatura era partita, scritto da chi l'ha registrata.
// `by_agent = 'user'`: una transizione verso `applied` fatta dal team non e'
// quella da annullare.
const PREVIOUS_STATE_SQL = `
  SELECT from_state FROM position_state_transitions
   WHERE position_id = ? AND to_state = 'applied' AND by_agent = 'user'
   ORDER BY id DESC LIMIT 1
`;

const TRANSITION_SQL = `
  INSERT INTO position_state_transitions
    (position_id, from_state, to_state, by_agent, notes)
  VALUES (?, ?, ?, 'user', ?)
`;

function toLegacyId(row) {
  const id = Number(row?.legacy_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Applica al database del box le candidature decise dall'utente sul web.
 *
 * @param {object} db  handle SQLite aperto in scrittura
 * @param {Array<object>} rows righe come le restituisce il cloud
 * @returns {{applied: number, undone: number, skipped: number}}
 */
export function applyAppliedBackflow(db, rows) {
  const outcome = { applied: 0, undone: 0, outcomes: 0, skipped: 0 };
  if (!Array.isArray(rows) || rows.length === 0) return outcome;

  const readLocal = db.prepare(LOCAL_SQL);
  const upsertApplication = db.prepare(UPSERT_APPLICATION_SQL);
  const clearApplication = db.prepare(CLEAR_APPLICATION_SQL);
  const writeOutcome = db.prepare(WRITE_OUTCOME_SQL);
  const readPrevious = db.prepare(PREVIOUS_STATE_SQL);
  const writeTransition = db.prepare(TRANSITION_SQL);
  const setStatus = db.prepare(
    "UPDATE positions SET status = ?, last_actor = 'user' WHERE id = ?",
  );

  for (const row of rows) {
    const legacyId = toLegacyId(row);
    if (legacyId === null) {
      outcome.skipped++;
      continue;
    }
    const local = readLocal.get(legacyId) || null;
    const verdict = decideAppliedBackflow({
      cloud: {
        applied: Boolean(row.applied) && Boolean(row.applied_at),
        appliedVia: row.applied_via ?? null,
      },
      local: local
        ? {
            applied: Boolean(local.applied),
            appliedVia: local.applied_via ?? null,
            status: local.status ?? null,
          }
        : null,
    });

    // L'esito e' un giudizio SUO: «e' partita?» e «com'e' andata?» sono due
    // domande, e la seconda ha una risposta anche quando la prima dice
    // «niente da fare» — anzi, e' proprio il caso normale, perche' la
    // candidatura il box ce l'ha gia' e cambia solo cio' che e' successo dopo.
    const outcomeVerdict = decideOutcomeBackflow({
      cloud: { response: row.response ?? null, responseAt: row.response_at ?? null },
      local: local
        ? { response: local.response ?? null, responseAt: local.response_at ?? null }
        : null,
    });

    if (verdict.action === "skip" && outcomeVerdict.action === "write") {
      const previousState = local.status ?? null;
      db.exec("BEGIN");
      try {
        writeOutcome.run(row.response, row.response_at ?? null, legacyId);
        if (previousState !== "response") {
          writeTransition.run(
            legacyId,
            previousState,
            "response",
            "esito registrato dall'utente sul web",
          );
          setStatus.run("response", legacyId);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      outcome.outcomes++;
      continue;
    }

    if (verdict.action === "skip") {
      outcome.skipped++;
      continue;
    }

    // Posizione e candidatura non devono poter raccontare due storie diverse:
    // o cambiano insieme o non cambia niente. Stessa scelta del click locale,
    // che le scrive in una transazione sola.
    db.exec("BEGIN");
    try {
      if (verdict.action === "apply") {
        upsertApplication.run(
          legacyId,
          row.applied_at,
          row.applied_via ?? APPLIED_VIA_USER,
        );
        if (local.status !== "applied") {
          writeTransition.run(
            legacyId,
            local.status ?? null,
            "applied",
            "candidatura registrata dall'utente sul web",
          );
        }
        setStatus.run("applied", legacyId);
        outcome.applied++;
        // Candidatura ED esito nello stesso giro: succede quando il box
        // scopre la riga in ritardo (spento, o mai sincronizzato) e nel
        // frattempo l'azienda ha gia' risposto. Fermarsi a `applied` qui
        // vorrebbe dire mettere in coda al team una candidatura che aspetta
        // una risposta gia' arrivata.
        if (outcomeVerdict.action === "write") {
          writeOutcome.run(row.response, row.response_at ?? null, legacyId);
          writeTransition.run(
            legacyId,
            "applied",
            "response",
            "esito registrato dall'utente sul web",
          );
          setStatus.run("response", legacyId);
          outcome.outcomes++;
        }
      } else {
        const previous = readPrevious.get(legacyId);
        const restored =
          previous?.from_state ??
          derivedPreviousState(
            Boolean(local.cv_path || local.cv_pdf_path),
            Number(local.n_scores) > 0,
          );
        clearApplication.run(legacyId);
        setStatus.run(restored, legacyId);
        writeTransition.run(
          legacyId,
          "applied",
          restored,
          "candidatura annullata dall'utente sul web",
        );
        outcome.undone++;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  return outcome;
}
