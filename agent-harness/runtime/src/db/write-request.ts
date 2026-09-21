/**
 * The person asking for a CV — `shared/skills/write_request.py` (T28).
 *
 * In the product `positions.write_requested = 1` is set by the PERSON: the
 * button on the dashboard, or `/cv <id>` on Telegram, both of which end at
 * this pair of statements. The CAPITANO then sees the position in
 * `db_query next-for-scrittore` and starts a SCRITTORE for it.
 *
 * In the harness there was no such thing, so a live rehearsal simulated the
 * request with an UPDATE typed into the test database by hand (20/09, said so
 * in the report). That is the wrong shape twice: it is not the product's
 * statement, and what a person does by hand cannot be part of a run.
 *
 * So the request lives here, and is reached only from the host: the operator's
 * command (`src/cli/user.ts`) and, during a live run, the hub's own path,
 * which asks for the team's token — the one no role has. **No role has a tool
 * that sets this flag**: a team that could ask itself to write a CV is a team
 * working for itself, and `db_update position` has never had the column.
 *
 * The guards are the script's, word for word, because the dashboard and the
 * Telegram command share them: a CV is requested on a `scored` position with
 * no application yet; a cover letter needs the application that a letter
 * accompanies. The one branch not ported is the CV rework
 * (`application_rework.rework_verdict`, [JHT-CV-REWORK]): it reads the CV's
 * PDF layout check, which the harness does not have (docs/parity.md says so
 * for `db_query next-for-scrittore` too). A rework request is refused here
 * with the reason the script gives when the verdict is not allowed.
 */

import type { Database } from "./jobs-db.ts";

export type WriteRequestKind = "cv" | "cover_letter";
export const WRITE_REQUEST_KINDS: readonly WriteRequestKind[] = ["cv", "cover_letter"];
export type WriteRequestMode = "on" | "off";

export interface WriteRequestResult {
  ok: boolean;
  error?: string;
  status_code?: string;
  rework_reason?: string | null;
  id?: number;
  title?: string | null;
  company?: string | null;
  score?: number | null;
  previous?: number;
  current?: number;
  kind?: string | null;
  rework?: boolean;
}

interface PositionRow {
  id: number;
  title: string | null;
  company: string | null;
  status: string | null;
  write_requested: number | null;
  write_request_kind: string | null;
  total_score: number | null;
  has_application: number;
}

/**
 * The timestamp columns the script bumps: now, or a millisecond past what is
 * there, so two requests in the same millisecond still order. Written as the
 * script writes it, `localtime` included — the queue is read by the same
 * comparison.
 */
const BUMP = (column: string) =>
  `${column} = CASE WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') > COALESCE(${column}, '') ` +
  `THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') ` +
  `ELSE strftime('%Y-%m-%d %H:%M:%f', ${column}, '+0.001 seconds') END`;

const SELECT_POSITION = `
        SELECT p.id, p.title, p.company, p.status, p.write_requested,
               p.write_request_kind, s.total_score,
               CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS has_application
          FROM positions p
          LEFT JOIN scores s ON s.position_id = p.id
          LEFT JOIN applications a ON a.position_id = p.id
         WHERE p.id = ?`;

/**
 * Turns the person's request on or off, and reports it as the script does:
 * one object, `ok` true or false with a `status_code` the caller can act on.
 * Everything is one immediate transaction, so two requests never interleave.
 */
export function requestWrite(db: Database, positionId: number, mode: WriteRequestMode = "on", kind: WriteRequestKind = "cv"): WriteRequestResult {
  if (!WRITE_REQUEST_KINDS.includes(kind)) return { ok: false, error: "Unknown write request kind", status_code: "BAD_KIND" };

  db.exec("BEGIN IMMEDIATE");
  let committed = false;
  try {
    const row = db.prepare(SELECT_POSITION).get(positionId) as PositionRow | undefined;
    if (!row) return { ok: false, error: `Position #${positionId} not found`, status_code: "NOT_FOUND" };

    const about = { id: row.id, title: row.title, company: row.company };
    const activeKind = row.write_requested ? (row.write_request_kind ?? "cv") : null;
    const changing = mode === "on" && activeKind !== kind;
    // [JHT-CV-REWORK] The script would ask `application_rework` here whether a
    // never-sent CV may be written again. That verdict reads the PDF's layout
    // check, which is not in the harness: the refusal below carries the reason.
    if (changing && kind === "cv" && row.status !== "scored") {
      return {
        ok: false,
        error: `Position has status '${row.status}': a CV request is allowed only from 'scored'`,
        status_code: "BAD_STATUS",
        rework_reason: NO_REWORK,
        ...about,
      };
    }
    if (changing && kind === "cv" && row.has_application === 1) {
      return {
        ok: false,
        error: `An application is already being processed (or was delivered) for #${positionId}`,
        status_code: "ALREADY_APPLIED",
        rework_reason: NO_REWORK,
        ...about,
      };
    }
    if (changing && kind === "cover_letter" && row.has_application !== 1) {
      return { ok: false, error: "A cover letter requires an existing application", status_code: "APPLICATION_REQUIRED", ...about };
    }

    const flag = mode === "on" ? 1 : 0;
    // Asking twice for the same thing is a real no-op: the timestamp, and with
    // it the place in the queue, stays the first request's. Turning off a kind
    // that is not the live one leaves the live one alone.
    const shouldWrite = flag ? activeKind !== kind : activeKind === kind;
    if (shouldWrite) {
      db.prepare(
        `UPDATE positions
            SET write_requested = ?,
                ${BUMP("write_requested_at")},
                write_request_kind = ?,
                ${BUMP("updated_at")}
          WHERE id = ?`,
      ).run(flag, flag ? kind : null, positionId);
    }
    const updated = db.prepare("SELECT write_requested, write_request_kind FROM positions WHERE id = ?").get(positionId) as {
      write_requested: number | null;
      write_request_kind: string | null;
    };
    db.exec("COMMIT");
    committed = true;
    return {
      ok: true,
      ...about,
      score: row.total_score,
      previous: Number(row.write_requested ?? 0),
      current: Number(updated.write_requested ?? 0),
      kind: updated.write_request_kind,
      rework: false,
    };
  } finally {
    if (!committed) db.exec("ROLLBACK");
  }
}

/** Why a rework is never allowed here, in the field the script puts its verdict's reason in. */
const NO_REWORK = "rework not available in the API harness: it needs the CV's layout check";
