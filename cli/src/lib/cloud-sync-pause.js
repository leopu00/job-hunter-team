// Pause and resume of the cloud sync: edits of cloud.json that keep the pairing.
//
// `jht cloud disable` deletes the file and revokes the token on the server; a pause only turns `enabled` off and
// leaves everything else as it was (token, user_id, base_url, supabase_*, the cursors next to the file), so that
// `resume` is one step. The reader of the switch is shared/cloud/sync-switch.js; this file is the only writer
// of its fields:
//   enabled      false while paused
//   paused_at    ISO time of the pause (present only while paused)
//   paused_by    «cli» (jht cloud pause), «installer» (paired with the sync left off), «release-0.4.0» (the migration)
//   sync_choice  «user» (the person chose, by pause, resume, enable or login), «migrated» (the migration paused it);
//                absent = an installation that never went through the choice
import {
  closeSync, constants, fchownSync, existsSync, fstatSync, fsyncSync, ftruncateSync, lstatSync, openSync,
  readFileSync, statSync, writeSync,
} from 'node:fs';
import { hasToken } from '../../../shared/cloud/sync-switch.js';
import { writePrivateJson } from './secure-config-io.js';

export const MIGRATION_PAUSED_BY = 'release-0.4.0';
/** Said once, by whoever runs the migration. */
export const MIGRATION_NOTICE =
  'Cloud sync is now paused on this machine and the pairing is kept. The site and its web commands stay offline; '
  + 'the terminal, the app and Telegram are not affected. To turn it back on: jht cloud resume';

const REAL_IO = Object.freeze({
  getuid: () => (typeof process.getuid === 'function' ? process.getuid() : undefined),
  statSync: (file) => statSync(file, { throwIfNoEntry: false }),
  fchownSync,
});

/**
 * Rewrite cloud.json without changing who owns it. The container runs as its own user and the folder is shared with the host
 * (rootful Docker): a rewrite by another user would leave the file owned by that user, unreadable by the container, and a
 * sync that is off for the wrong reason. Same owner: the atomic rewrite (0600). Root: the atomic rewrite, with the new file given
 * to its owner on its descriptor BEFORE the rename (never by path after it: a link planted meanwhile would be followed).
 * Another user, not root: the file is rewritten IN PLACE (same inode, same owner and mode) when it can be
 * written, and not at all when it cannot.
 * @returns {'written'|'foreign-owner'}  `foreign-owner`: nothing was written; the container does it at its own start.
 */
export function writeCloudFile(file, value, io = REAL_IO) {
  const before = io.statSync(file);
  const me = io.getuid();
  if (!before || me === undefined || before.uid === me) {
    writePrivateJson(file, value);
    return 'written';
  }
  if (me === 0) {
    // The owner is given on the descriptor of the new file BEFORE it takes the place of the old one: by path, after the
    // rename, it would follow a link that an agent put there in the meantime and give root's file to the agent.
    writePrivateJson(file, value, { onFd: (fd) => io.fchownSync(fd, before.uid, before.gid) });
    return 'written';
  }
  let fd;
  try {
    const entry = lstatSync(file);
    if (entry.isSymbolicLink() || !entry.isFile()) return 'foreign-owner';
    fd = openSync(file, constants.O_RDWR | (constants.O_NOFOLLOW || 0));
    const opened = fstatSync(fd);
    if (opened.ino !== entry.ino || opened.dev !== entry.dev) return 'foreign-owner';
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    writeSync(fd, bytes, 0, bytes.length, 0);
    ftruncateSync(fd, bytes.length);
    fsyncSync(fd);
    return 'written';
  } catch {
    return 'foreign-owner';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The rotated refresh token goes into cloud.json, and ONLY it. The file is read again right before it is written and
 * only `supabase_refresh_token` is set on what that read returns, so a pause (or a resume) that landed since the first
 * read stays. `beforeWrite` runs between the first read and the second (a test makes the file change there).
 * What stays is the few microseconds between the second read and the rename: there is no lock between the processes.
 * @returns {'written'|'foreign-owner'}
 */
export function saveRefreshToken(file, newToken, { beforeWrite, io } = {}) {
  readFileSync(file, 'utf-8'); // a file that is not there, or unreadable, is the caller's error to say
  if (beforeWrite) beforeWrite();
  const fresh = JSON.parse(readFileSync(file, 'utf-8'));
  return writeCloudFile(file, { ...fresh, supabase_refresh_token: newToken }, io);
}

/** The file as it is: an object, or null when absent, unreadable or not an object. */
export function readCloudFile(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** @returns {{ok: boolean, changed?: boolean, reason?: string, config?: object}} */
export function pauseCloud(file, { by = 'cli', now = new Date(), io } = {}) {
  const config = readCloudFile(file);
  if (!config || !hasToken(config)) return { ok: false, reason: 'not-paired' };
  if (config.enabled !== true && typeof config.paused_at === 'string' && config.paused_at !== '') {
    return { ok: true, changed: false, config };
  }
  const next = { ...config, enabled: false, paused_at: now.toISOString(), paused_by: by, sync_choice: 'user' };
  if (writeCloudFile(file, next, io) !== 'written') return { ok: false, reason: 'foreign-owner' };
  return { ok: true, changed: true, config: next };
}

/** @returns {{ok: boolean, changed?: boolean, reason?: string, config?: object}} */
export function resumeCloud(file, { io } = {}) {
  const config = readCloudFile(file);
  if (!config || !hasToken(config)) return { ok: false, reason: 'not-paired' };
  if (config.enabled === true && config.sync_choice === 'user') return { ok: true, changed: false, config };
  const { paused_at: _a, paused_by: _b, ...rest } = config;
  const next = { ...rest, enabled: true, sync_choice: 'user' };
  if (writeCloudFile(file, next, io) !== 'written') return { ok: false, reason: 'foreign-owner' };
  return { ok: true, changed: true, config: next };
}

/**
 * One-time migration: a pairing that was on before this version and never went through the choice is paused,
 * once. Without a file nothing is created. `resume` (and pause, enable, login) write sync_choice, so the
 * migration never comes back on its own.
 * @returns {{migrated: boolean, skipped?: string}}
 */
export function migrateSyncChoice(file, { now = new Date(), io } = {}) {
  if (!existsSync(file)) return { migrated: false };
  const config = readCloudFile(file);
  if (!config || config.enabled !== true || (config.sync_choice !== undefined && config.sync_choice !== null)) {
    return { migrated: false };
  }
  const written = writeCloudFile(file, {
    ...config, enabled: false, paused_at: now.toISOString(), paused_by: MIGRATION_PAUSED_BY, sync_choice: 'migrated',
  }, io);
  // Another user owns the file and cannot write it: not here. The container migrates at its own start, as the owner.
  if (written !== 'written') return { migrated: false, skipped: 'foreign-owner' };
  return { migrated: true };
}
