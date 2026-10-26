// jht profile import — gives the team its candidate profile from the CLI.
//
// What the app does when the person completes the profile (assistant, profile-yaml
// skill): the profile is written to candidate_profile.yml and validated, ready.flag
// is created and checked, and the Capitano is told once: that message is the
// trigger of its first-run burst. Without it the team stays at
// first_run=awaiting_profile and no Scout starts. This does the same steps, in the
// same order, with the same refusals, and no shortcut.
//
// Everything that touches the disk or another process comes in as a parameter, so
// the tests run it against a folder of their own.

import {
  closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync,
  renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

// The most the app's own import reads (desktop/src-tauri/src/profile_import.rs).
export const MAX_PROFILE_BYTES = 64 * 1024;

const PROFILE_FILE = 'candidate_profile.yml';
const READY_FLAG = 'ready.flag';
const PRIVATE_FILE_MODE = 0o600;

// Said to the Capitano as the person's console: the envelope of the Assistant is not
// ours to wear (the transport refuses an envelope that is not the sender's).
export const PROFILE_READY_MESSAGE =
  'The candidate profile is complete and validated (imported with jht profile import): '
  + 'the team can start. Run first_run.py status and follow your first-run-burst skill.';

function refuse(code, extra = {}) {
  return { ok: false, code, ...extra };
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

// A new private file next to its target, created and never followed: O_EXCL refuses
// a name already there, link included.
function writeStage(dir, label, bytes) {
  const path = join(dir, `.${label}.${process.pid}-${randomBytes(6).toString('hex')}.stage`);
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),
    PRIVATE_FILE_MODE,
  );
  try {
    writeSync(fd, bytes, 0, bytes.length, 0);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return path;
}

function dropStage(path) {
  try { unlinkSync(path); } catch { /* already gone */ }
}

function utcStamp(now) {
  return `${now().toISOString().slice(0, 19)}Z\n`;
}

/**
 * @param {object} o
 * @param {Buffer} o.bytes        the profile, as read from the person's file
 * @param {boolean} [o.replace]   an existing profile may be replaced
 * @param {string} o.profileDir   $JHT_HOME/profile
 * @param {(path:string)=>{ok:boolean,errors?:string[],unavailable?:boolean}} o.validate  strict validation of a file
 * @param {()=>boolean} o.reviewPending  a profile review waits for the person's confirmation
 * @param {()=>{status:'sent'|'team_off'|'failed',detail?:string}} o.notify  tells the Capitano
 * @param {()=>Date} [o.now]
 */
export function importProfile({ bytes, replace = false, profileDir, validate, reviewPending, notify, now = () => new Date() }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return refuse('profile_empty');
  if (bytes.length > MAX_PROFILE_BYTES) return refuse('profile_too_large');
  if (bytes.includes(0)) return refuse('profile_invalid', { errors: ['the file is not text'] });
  // The same as the app: a review waiting for the person's confirmation is not to be
  // written over by another source.
  if (reviewPending()) return refuse('profile_review_pending');

  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const target = join(profileDir, PROFILE_FILE);
  const present = lstatOrNull(target);
  if (present && (present.isSymbolicLink() || !present.isFile())) return refuse('profile_target_unsafe');
  if (present && !replace) return refuse('profile_exists');

  // Validated where it will be read: the staged copy, not the file the person pointed at.
  const stage = writeStage(profileDir, PROFILE_FILE, bytes);
  try {
    const verdict = validate(stage);
    if (verdict.unavailable) return refuse('validator_unavailable');
    if (!verdict.ok) return refuse('profile_invalid', { errors: verdict.errors ?? [] });
    // Looked at again at the last moment: a link or a pipe put there meanwhile is not replaced.
    const late = lstatOrNull(target);
    if (late && (late.isSymbolicLink() || !late.isFile())) return refuse('profile_target_unsafe');
    if (late && !replace) return refuse('profile_exists');
    renameSync(stage, target);
  } finally {
    dropStage(stage); // gone already after the rename; this cleans a refused one
  }

  // ready.flag, written whole and checked on the disk before anyone is told (the app's
  // rule: "never announce without FLAG_OK").
  const flagPath = join(profileDir, READY_FLAG);
  const flagStage = writeStage(profileDir, READY_FLAG, Buffer.from(utcStamp(now), 'utf8'));
  try {
    renameSync(flagStage, flagPath);
  } catch (err) {
    dropStage(flagStage);
    throw err;
  }
  const flag = lstatOrNull(flagPath);
  if (!flag || !flag.isFile()) return refuse('ready_flag_missing', { profileWritten: true });

  const told = notify();
  return { ok: true, profileWritten: true, readyFlag: true, captain: told.status, ...(told.detail ? { detail: told.detail } : {}) };
}
