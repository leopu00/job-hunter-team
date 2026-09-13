import Database from "better-sqlite3";
import { JHT_DB_PATH } from "./jht-paths";
import { assertApplicationAnswerReply } from "./application-answer-request";
import { AUTHORISABLE_STATUS, applyToggleVerdict } from "./apply-request-rule";

/**
 * Persist a dashboard reply in local mode. A CLOSER form answer also renews
 * the user's per-position authorisation in the same SQLite transaction.
 */
export function replyPendingMessageLocal(id: string, reply: string): boolean {
  const db = new Database(JHT_DB_PATH);
  try {
    db.pragma("journal_mode = WAL");
    const at = new Date().toISOString();
    return db.transaction(() => {
      const target = db
        .prepare(
          `SELECT agent, kind, related_position_id, source_action, source_payload
             FROM pending_user_messages WHERE id = ?`,
        )
        .get(id) as
        | {
            agent: string;
            kind: string;
            related_position_id: number | null;
            source_action: string | null;
            source_payload: string | null;
          }
        | undefined;
      if (!target) return false;

      const result = db
        .prepare(
          `UPDATE pending_user_messages
              SET user_reply = ?,
                  user_reply_at = ?,
                  acknowledged_at = COALESCE(acknowledged_at, ?)
            WHERE id = ?`,
        )
        .run(reply, at, at, id);

      const closerAnswer =
        target.agent === "closer" &&
        target.kind === "question" &&
        target.source_action === "closer_application_answer" &&
        target.related_position_id != null;
      if (closerAnswer) {
        assertApplicationAnswerReply(
          target.source_payload,
          reply,
          target.related_position_id!,
        );
        // Same rule as the apply-request route and the box gate: an answer
        // never re-authorises an application that has already been sent.
        const current = db
          .prepare(
            `SELECT p.status, a.applied
               FROM positions p
               LEFT JOIN applications a ON a.position_id = p.id
              WHERE p.id = ?`,
          )
          .get(target.related_position_id) as
          | { status: string | null; applied: number | null }
          | undefined;
        const verdict = applyToggleVerdict({
          status: current?.status ?? null,
          applied: current?.applied === 1,
          requested: true,
        });
        if (!verdict.ok) {
          throw new Error(`closer_answer_${verdict.reason}`);
        }
        const authorised = db
          .prepare(
            `UPDATE positions
                SET apply_requested = 1,
                    apply_requested_at = ?,
                    apply_requested_by = 'user_local',
                    -- The box push reads updated_at as its cursor: a renewed
                    -- authorisation that does not move it never leaves home.
                    updated_at = CASE
                      WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
                           > COALESCE(updated_at, '')
                      THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
                      ELSE strftime('%Y-%m-%d %H:%M:%f', updated_at, '+0.001 seconds')
                    END
              WHERE id = ? AND status = ?`,
          )
          .run(at, target.related_position_id, AUTHORISABLE_STATUS);
        if (authorised.changes !== 1) {
          throw new Error("closer_answer_position_not_ready");
        }
        const observed = db
          .prepare(
            `SELECT apply_requested, apply_requested_at, apply_requested_by
               FROM positions WHERE id = ?`,
          )
          .get(target.related_position_id) as
          | {
              apply_requested: number;
              apply_requested_at: string | null;
              apply_requested_by: string | null;
            }
          | undefined;
        if (
          !observed ||
          observed.apply_requested !== 1 ||
          observed.apply_requested_at !== at ||
          observed.apply_requested_by !== "user_local"
        ) {
          throw new Error("closer_answer_authorisation_not_observed");
        }
      }
      return result.changes > 0;
    })();
  } finally {
    db.close();
  }
}
