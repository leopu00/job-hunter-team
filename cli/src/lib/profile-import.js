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
  readdirSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readRegularFile } from './secure-config-io.js';

// The most the app's own import reads (desktop/src-tauri/src/profile_import.rs).
export const MAX_PROFILE_BYTES = 64 * 1024;

const PROFILE_FILE = 'candidate_profile.yml';
const READY_FLAG = 'ready.flag';
const PRIVATE_FILE_MODE = 0o600;
// --replace keeps the profile it replaces, once, next to it; a profile is not a large file.
const PREVIOUS_FILE = 'candidate_profile.yml.prev';
const MAX_PREVIOUS_BYTES = 4 * 1024 * 1024;
// A stage lives for the length of one import. Older than this it was left by a process that died.
const ORPHAN_STAGE_MS = 5 * 60 * 1000;
const STAGE_NAME = /^\.(candidate_profile\.yml|ready\.flag)\.\d+-[0-9a-f]{12}\.stage$/;

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

// The stages a dead process left (they hold a copy of the profile), and only those:
// the names this module gives them, regular files, old enough not to be another import's.
function dropOrphanStages(dir, now) {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!STAGE_NAME.test(name)) continue;
    const path = join(dir, name);
    try {
      const info = lstatSync(path);
      if (info.isFile() && now().getTime() - info.mtimeMs > ORPHAN_STAGE_MS) unlinkSync(path);
    } catch { /* gone, or not ours to remove */ }
  }
}

// The profile about to be replaced is kept as it is, private, replacing the one kept before.
function keepPrevious(dir, target) {
  const bytes = readRegularFile(target, { maxBytes: MAX_PREVIOUS_BYTES });
  const copy = writeStage(dir, PROFILE_FILE, bytes); // a stage name the orphan sweep knows
  try {
    renameSync(copy, join(dir, PREVIOUS_FILE));
  } catch (err) {
    dropStage(copy);
    throw err;
  }
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
 * @param {()=>'declared'|'missing'|'unknown'} [o.planDeclared]  the subscription plan, which the Capitano's
 *        first run cannot open without (first_run.py begin-burst refuses to guess a roster)
 * @param {()=>Date} [o.now]
 */
export function importProfile({
  bytes, replace = false, profileDir, validate, reviewPending, notify, planDeclared = () => 'unknown', now = () => new Date(),
}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return refuse('profile_empty');
  if (bytes.length > MAX_PROFILE_BYTES) return refuse('profile_too_large');
  if (bytes.includes(0)) return refuse('profile_invalid', { errors: ['the file is not text'] });
  // The same as the app: a review waiting for the person's confirmation is not to be
  // written over by another source.
  if (reviewPending()) return refuse('profile_review_pending');

  dropOrphanStages(profileDir, now);
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const target = join(profileDir, PROFILE_FILE);
  const present = lstatOrNull(target);
  if (present && (present.isSymbolicLink() || !present.isFile())) return refuse('profile_target_unsafe');
  if (present && !replace) return refuse('profile_exists');

  // Validated where it will be read: the staged copy, not the file the person pointed at.
  const stage = writeStage(profileDir, PROFILE_FILE, bytes);
  let replacedPrevious = false;
  try {
    const verdict = validate(stage);
    if (verdict.unavailable) return refuse('validator_unavailable');
    if (!verdict.ok) {
      return refuse('profile_invalid', { errors: verdict.errors ?? [], ...(verdict.missing?.length ? { missing: verdict.missing } : {}) });
    }
    // Looked at again at the last moment: a link or a pipe put there meanwhile is not replaced.
    const late = lstatOrNull(target);
    if (late && (late.isSymbolicLink() || !late.isFile())) return refuse('profile_target_unsafe');
    if (late && !replace) return refuse('profile_exists');
    if (late) {
      keepPrevious(profileDir, target);
      replacedPrevious = true;
    }
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
  return {
    ok: true, profileWritten: true, readyFlag: true, captain: told.status, plan: planDeclared(),
    ...(replacedPrevious ? { previousKept: PREVIOUS_FILE } : {}),
    ...(told.detail ? { detail: told.detail } : {}),
  };
}

/** Exit code of an import that wrote the profile but could not tell the Capitano: not the full success of 0. */
export const EXIT_CAPTAIN_NOT_TOLD = 3;

/**
 * What the person is told after an import that WROTE the profile, and the exit code. The Capitano's own message can fail
 * (its composer held a text that was not provably ours, the pane was busy): the profile is saved and the Capitano finds
 * it at its next wake, but the team does not start now, and `ok:true` with a quiet line was read as a full success
 * (TEST 10, 27/10: «captain:failed» behind an ok). So that case is said, as a warning and with the way to try again, and
 * answers with its own exit code.
 *
 * @param {object} result  the `ok:true` answer of importProfile
 * @returns {{ exitCode: number, json: object, out: string[], warn: string[] }}
 */
export function importOutcome(result) {
  const out = [];
  const warn = [];
  const kept = result.previousKept
    ? [`The profile it replaced was kept, private, as ${result.previousKept} next to it.`]
    : [];
  const plan = result.plan === 'missing'
    ? [
        'No subscription plan is declared, and the Capitano does not open the first run without one.',
        'See the plans and declare yours with: jht providers plan   (then: jht providers plan <id>)',
      ]
    : [];
  if (result.captain === 'failed') {
    out.push('Profile saved.', ...kept);
    warn.push(
      `Warning: the Capitano was NOT told (${result.detail ?? 'delivery failed'}): the team does not start now.`,
      'It finds the profile at its next wake; to tell it now, run the same import again with --replace.',
    );
    out.push(...plan);
    return {
      exitCode: EXIT_CAPTAIN_NOT_TOLD,
      json: { ...result, captainTold: false, retry: 'run the same import again with --replace' },
      out,
      warn,
    };
  }
  out.push('Profile imported and ready.', ...kept);
  if (result.captain === 'sent') out.push('The Capitano has been told: the team starts.');
  else if (result.captain === 'team_off') {
    out.push('The team is not running: the Capitano will start it from this profile at its next wake. Start the team with: jht team start');
  }
  out.push(...plan);
  return { exitCode: 0, json: { ...result, captainTold: result.captain === 'sent' }, out, warn };
}
