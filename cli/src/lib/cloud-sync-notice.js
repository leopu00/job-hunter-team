// cloud-sync-notice.js — tell the user, once per token, that the website refuses the box's sync token.
//
// An expired or revoked token makes every push answer 401: nothing reaches the
// website again, and the website cannot say so, because it is the box that no
// longer reaches it. After AUTH_NOTICE_AFTER_FAILURES refused pushes in a row the
// box tells the user on its own channel: shared/skills/cloud_sync_notice.py, a
// closed code with a fixed sentence in the user's language (a row in the app's
// panel, mirrored in the chat, and Telegram when linked). The key is the token's
// public prefix, so the same token is told once, and a new token that is refused
// in its turn is told again.
//
// Best-effort and never thrown: a notice that could not go out must not stop the
// daemon that found the refusal.

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLOUD_SYNC_NOTICE_SCRIPT = join(HERE, '../../../shared/skills/cloud_sync_notice.py');

/** Refused pushes in a row before the user is told: one is a hiccup, three are a token gone. */
export const AUTH_NOTICE_AFTER_FAILURES = 3;

/** The token's public prefix, as the website lists it (web/lib/cloud-sync/tokens.ts), or null. */
export function tokenPublicPrefix(token) {
  if (typeof token !== 'string' || !token.startsWith('jht_sync_')) return null;
  const prefix = token.slice(0, 'jht_sync_'.length + 4);
  return /^jht_sync_[A-Za-z0-9_-]{4}$/.test(prefix) ? prefix : null;
}

function defaultRun(args) {
  return new Promise((resolve) => {
    execFile('python3', [CLOUD_SYNC_NOTICE_SCRIPT, ...args], { timeout: 70_000, maxBuffer: 1 << 16 }, (err, stdout) => {
      if (err) return resolve({ notified: false, reason: 'notice_script_failed' });
      try {
        resolve(JSON.parse(String(stdout).trim().split('\n').pop()));
      } catch {
        resolve({ notified: false, reason: 'notice_script_unreadable' });
      }
    });
  });
}

// The keys already told by this process: the daemon checks every few seconds, and
// a refused token stays refused, so the script runs once, not at every check
// (the row's own key keeps it one across restarts).
const told = new Set();

/**
 * After a periodic push: tell the user when the website has refused the token
 * enough times in a row. Returns what was done, never throws.
 *
 * @param {{ status?: string, consecutive_failures?: number } | null | undefined} state
 * @param {string | null | undefined} token
 * @param {{ run?: (args: string[]) => Promise<object>, log?: (msg: string) => void, memo?: Set<string> }} [options]
 */
export async function noticeRefusedToken(state, token, { run = defaultRun, log = () => {}, memo = told } = {}) {
  if (state?.status !== 'auth_failed') return { notified: false, reason: 'not_refused' };
  if ((Number(state.consecutive_failures) || 0) < AUTH_NOTICE_AFTER_FAILURES) {
    return { notified: false, reason: 'not_yet' };
  }
  const key = tokenPublicPrefix(token);
  if (!key) return { notified: false, reason: 'token_unreadable' };
  if (memo.has(key)) return { notified: false, reason: 'already_told' };
  let result;
  try {
    result = await run(['token_rejected', key]);
  } catch {
    result = { notified: false, reason: 'notice_script_failed' };
  }
  if (result?.notified) memo.add(key);
  else log(`cloud-sync notice not sent: ${result?.reason || 'unknown'}`);
  return result;
}

// The keys already told for a lost session, apart from the refused tokens above.
const toldLostSession = new Set();

/**
 * When the daemon could not authenticate with Supabase because the session of this device is gone
 * (cloud-realtime.js: RealtimeSessionLostError), tell the user once, in their language, that the box
 * now follows the website with slower checks and has to be paired again from the app. The key is the
 * sync token's public prefix, so a restart does not tell it twice (the row's own key keeps it one)
 * and a new pairing that is lost in its turn is told again. Anything else that went wrong with the
 * Realtime setup (network, config) is not a lost session and says nothing. Never throws.
 *
 * @param {{ code?: string } | null | undefined} error
 * @param {string | null | undefined} token
 * @param {{ run?: (args: string[]) => Promise<object>, log?: (msg: string) => void, memo?: Set<string> }} [options]
 */
export async function noticeLostSession(error, token, { run = defaultRun, log = () => {}, memo = toldLostSession } = {}) {
  if (error?.code !== 'session_lost') return { notified: false, reason: 'not_lost' };
  const key = tokenPublicPrefix(token);
  if (!key) return { notified: false, reason: 'token_unreadable' };
  if (memo.has(key)) return { notified: false, reason: 'already_told' };
  let result;
  try {
    result = await run(['session_lost', key]);
  } catch {
    result = { notified: false, reason: 'notice_script_failed' };
  }
  if (result?.notified) memo.add(key);
  else log(`cloud-sync notice not sent: ${result?.reason || 'unknown'}`);
  return result;
}
