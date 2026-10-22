// web-action-notice.js — the out-of-band notice of an action taken from the website.
//
// An authorisation, a stop of the team or a team order written on the website
// with the user's session reaches the box through the cloud; whoever holds the
// session can take it. The box tells the user on a channel the website does not
// hold: shared/skills/web_action_notice.py, a closed code with a fixed sentence
// in the user's language (Telegram when linked, and a row in the app's panel,
// mirrored in the chat). One notice per event: the key names it.
//
// Best-effort and never thrown: a notice that could not go out must not stop the
// sync that found the event. The caller runs it AFTER closing its database, so
// the script's write does not wait on the caller's lock.

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const NOTICE_SCRIPT = join(HERE, '../../../shared/skills/web_action_notice.py');

export const WEB_ACTION_CODES = Object.freeze([
  'apply_authorized_from_web',
  'apply_revoked_from_web',
  'team_stopped_from_web',
  'team_started_from_web',
  'team_restarted_from_web',
  'directive_changed_from_web',
]);

const KEY = /^[A-Za-z0-9_.:-]{1,120}$/;

/** The part of a key that comes from an instant: its milliseconds, or null. */
export function instantKey(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const zoned = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text);
  const ms = Date.parse(zoned ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? String(ms) : null;
}

function defaultRun(args, { dbPath } = {}) {
  // The notice goes into the database the caller synced, not the default one.
  const env = dbPath ? { ...process.env, JHT_DB: dbPath } : process.env;
  return new Promise((resolve) => {
    execFile('python3', [NOTICE_SCRIPT, ...args], { timeout: 70_000, maxBuffer: 1 << 16, env }, (err, stdout) => {
      if (err) return resolve({ notified: false, reason: 'notice_script_failed' });
      try {
        resolve(JSON.parse(String(stdout).trim().split('\n').pop()));
      } catch {
        resolve({ notified: false, reason: 'notice_script_unreadable' });
      }
    });
  });
}

/**
 * Tell the user about one action from the website.
 *
 * @param {{ code: string, key: string, positionId?: number }} notice
 * @param {{ run?: (args: string[], opts: object) => Promise<object>, log?: (msg: string) => void, dbPath?: string }} [options]
 */
export async function noticeWebAction({ code, key, positionId }, { run = defaultRun, log = () => {}, dbPath } = {}) {
  if (!WEB_ACTION_CODES.includes(code)) return { notified: false, reason: 'code_unknown' };
  if (typeof key !== 'string' || !KEY.test(key)) return { notified: false, reason: 'key_invalid' };
  const args = [code, key];
  if (positionId != null) args.push('--position-id', String(positionId));
  let result;
  try {
    result = await run(args, { dbPath });
  } catch {
    result = { notified: false, reason: 'notice_script_failed' };
  }
  if (!result?.notified) log(`web-action notice not sent (${code}): ${result?.reason || 'unknown'}`);
  return result;
}

/** All of them, one after the other; never throws. */
export async function noticeWebActions(notices, options = {}) {
  const results = [];
  for (const notice of notices) results.push(await noticeWebAction(notice, options));
  return results;
}
