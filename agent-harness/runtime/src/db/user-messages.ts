/**
 * A message to the person, in `pending_user_messages` — what
 * `agents/_tools/jht-notify-user` writes (B1-T3).
 *
 * In the TUI the row is the message: the chat sync (`cli/src/lib/chat-sync.js`)
 * mirrors it into the role's chat and `jht cloud push` carries it to the web.
 * The API roles wrote their `notify_user` only to `channels/notify.jsonl`,
 * which nothing reads into the database: the CAPITANO, MENTOR, ASSISTENTE
 * and CLOSER of an API team were talking to the person in a file the web
 * never sees. The file stays, as the record of what was sent; the row is
 * what reaches the person.
 *
 * The row is the script's, column for column:
 *  - `agent` is the ROLE (`capitano`, never `capitano-1`): every call in the
 *    prompts is `jht-notify-user --agent capitano`, and the sync mirrors only
 *    the roles it chats as (`CHAT_AGENTS`);
 *  - the body with `\n`, `\t`, `\r` written out turned into the characters,
 *    as `interpret_escapes` does before the row and Telegram;
 *  - the insert, then `delivered_via = 'web'` with `delivered_at` — the
 *    script's second statement when Telegram is not reached, and here there
 *    is no Telegram;
 *  - a position that is not in the database is refused by the foreign key,
 *    and nothing is sent: the script exits 2 on the same insert.
 */

import { roleOf } from "./role-policy.ts";
import type { Database } from "./jobs-db.ts";
import type { Notifier, UserNotification } from "../parity/jht-tools.ts";

/** `interpret_escapes` of jht-notify-user: only the three common escapes, never a generic decode. */
export function interpretEscapes(text: string): string {
  return text.replaceAll("\\n", "\n").replaceAll("\\t", "\t").replaceAll("\\r", "\r");
}

export class UnknownPositionError extends Error {
  readonly positionId: number;
  constructor(positionId: number) {
    super(`Position ${positionId} is not in jobs.db: the message was not sent. Send it without position_id, or with the id of a position that exists.`);
    this.name = "UnknownPositionError";
    this.positionId = positionId;
  }
}

/** Writes the row `jht-notify-user` writes, delivered on the web; returns its id. */
export function recordUserMessage(db: Database, n: UserNotification): number {
  const positionId = n.positionId ?? null;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Inside the transaction: a position removed between the check and the
    // insert would otherwise come back as a foreign-key SqliteError, a 500
    // with the slot spent, instead of the refusal the role can act on.
    if (positionId !== null && db.prepare("SELECT 1 FROM positions WHERE id = ?").get(positionId) === undefined) {
      throw new UnknownPositionError(positionId);
    }
    const { lastInsertRowid } = db
      .prepare("INSERT INTO pending_user_messages (agent, body, kind, related_position_id) VALUES (?, ?, ?, ?)")
      .run(roleOf(n.from), interpretEscapes(n.text), n.kind, positionId);
    const id = Number(lastInsertRowid);
    db.prepare("UPDATE pending_user_messages SET delivered_via = 'web', delivered_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    db.exec("COMMIT");
    return id;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * The row first, then the record: a message the database refused is not
 * written in the record as sent.
 *
 * Once the row is written the message is sent: it is what reaches the
 * person. A record that then fails (notify.jsonl not writable, a full disk)
 * is said on stderr and not raised: raised, the role heard "not sent", sent
 * it again, and the person got the same message twice, since the API side
 * has no idempotency key (the script's `source_id`).
 */
export class JobsDbNotifier implements Notifier {
  readonly #db: () => Database;
  readonly #record: Notifier;
  readonly #onRecordError: (error: unknown) => void;

  constructor(db: () => Database, record: Notifier, onRecordError?: (error: unknown) => void) {
    this.#db = db;
    this.#record = record;
    this.#onRecordError =
      onRecordError ??
      ((error) => process.stderr.write(`notify: the message is sent, its record in notify.jsonl failed: ${error instanceof Error ? error.message : String(error)}\n`));
  }

  async notify(n: UserNotification): Promise<void> {
    recordUserMessage(this.#db(), n);
    try {
      await this.#record.notify(n);
    } catch (error) {
      this.#onRecordError(error);
    }
  }
}
