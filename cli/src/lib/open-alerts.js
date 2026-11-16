/**
 * The alerts for the person that nobody has read yet (pending_user_messages, kind=alert, not acknowledged): the Capitano's
 * «no spending ceiling, how to set one», a source that gives nothing, the box that no longer reaches the website. They are
 * delivered on the web (Messages) or on Telegram; whoever follows the team from the terminal saw none of them. `jht team
 * status` and `jht team start` say them. Read-only: what is said here is not marked as read (the web still shows it).
 */
import { existsSync } from 'node:fs';
import { JHT_DB_PATH } from '../jht-paths.js';

/** An alert older than this is not said again at every status: it is in the Messages of the app. */
export const ALERT_WINDOW_DAYS = 7;
const MAX_ALERTS = 3;
const MAX_BODY = 400;

const clean = (text) => {
  const plain = String(text ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]/g, '').trim();
  return plain.length > MAX_BODY ? `${plain.slice(0, MAX_BODY - 1)}…` : plain;
};

/** The agent of a row as a name: only letters, digits, «_» and «-» (an agent id), anything else is no name. The body is cleaned by
 * `clean`; the agent is written by the same tools and is printed on the terminal too, so it does not go through unchecked. */
export const safeAgent = (agent) => {
  const plain = String(agent ?? '');
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(plain) ? plain.toLowerCase() : '';
};

/**
 * @returns {Promise<Array<{ id: number, agent: string, body: string, createdAt: string }>>} newest first, one per source;
 *   [] when there is no database or it cannot be read (nothing here stops a command).
 */
export async function openAlerts({ dbPath = JHT_DB_PATH, windowDays = ALERT_WINDOW_DAYS } = {}) {
  if (!existsSync(dbPath)) return [];
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(
      `SELECT MAX(id) AS id, MAX(created_at) AS at FROM pending_user_messages
        WHERE kind = 'alert' AND COALESCE(author, 'agent') = 'agent' AND acknowledged_at IS NULL
          AND created_at >= datetime('now', ?)
        GROUP BY COALESCE(source_id, 'row-' || id)
        ORDER BY at DESC, id DESC LIMIT ?`,
    ).all(`-${Number(windowDays)} days`, MAX_ALERTS);
    const ids = rows.map((r) => Number(r.id));
    if (!ids.length) return [];
    const full = db.prepare(`SELECT id, agent, body, created_at FROM pending_user_messages WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC, id DESC`).all(...ids);
    return full.map((r) => ({ id: Number(r.id), agent: safeAgent(r.agent), body: clean(r.body), createdAt: String(r.created_at ?? '') }))
      .filter((r) => r.body);
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

/** The name of the agent as the person knows it (capitano → Capitano). */
export const agentLabel = (agent) => (agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : '?');

/** The lines `jht team status` and `jht team start` print for the open alerts (none when there are none). */
export async function openAlertLines(options = {}) {
  const { say } = await import('./texts.js');
  const alerts = await openAlerts(options);
  if (!alerts.length) return [];
  return [...alerts.map((a) => say('alerts.open', { agent: agentLabel(a.agent), body: a.body })), say('alerts.where')];
}
