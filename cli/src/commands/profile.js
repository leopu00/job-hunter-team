import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdtempSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { JHT_PROFILE_DIR } from '../jht-paths.js';
import { readRegularFile } from '../lib/secure-config-io.js';
import { MAX_PROFILE_BYTES, PROFILE_READY_MESSAGE, importProfile } from '../lib/profile-import.js';
import { resolveSession, sendMessage } from './team/chat.js';

// shared/skills/validate_profile.py risolto relativo a questo file:
// cli/src/commands → cli/src → cli → <repo root> → shared/skills/…
const __dirname = dirname(fileURLToPath(import.meta.url));
const VALIDATOR = join(__dirname, '../../../shared/skills/validate_profile.py');
const DEFAULT_PROFILE = join(JHT_PROFILE_DIR, 'candidate_profile.yml');

function validateAction(file, opts) {
  if (opts.stdin) return validateStdin(file, opts);
  const target = file || DEFAULT_PROFILE;
  if (!existsSync(VALIDATOR)) {
    console.error(`: validator not found: ${VALIDATOR}`);
    process.exitCode = 2;
    return;
  }
  const args = [VALIDATOR, target];
  if (opts.strict) args.push('--strict');
  if (opts.json) args.push('--json');
  const r = spawnSync('python3', args, { stdio: 'inherit' });
  if (r.error) {
    console.error(`: impossible to run python3: ${r.error.message}`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = r.status ?? 0;
}

// shared/skills/profile_review.py: a review that waits for the person's confirmation.
const REVIEW_PENDING_PROBE =
  'import sys; sys.path.insert(0, sys.argv[1]); import profile_review; '
  + 'sys.exit(0 if profile_review.status() is None else 43)';

function reviewPending() {
  const r = spawnSync('python3', ['-I', '-c', REVIEW_PENDING_PROBE, dirname(VALIDATOR)], { stdio: 'ignore' });
  // Cannot tell is not "nothing pending": the import does not go on blind.
  return r.status !== 0;
}

function validateStrict(path) {
  const r = spawnSync('python3', [VALIDATOR, path, '--strict', '--json', '--minimum'], { encoding: 'utf8' });
  if (r.error || r.status === 2) return { ok: false, unavailable: true };
  try {
    const out = JSON.parse(r.stdout);
    return { ok: out.ok === true, errors: [...(out.errors ?? []), ...(out.warnings ?? [])], missing: out.missing ?? [] };
  } catch {
    return { ok: false, errors: ['the validator gave no answer'] };
  }
}

// The first run opens only on a declared plan (first_run.py begin-burst does not guess a roster).
function planDeclared() {
  const r = spawnSync('python3', ['-I', join(dirname(VALIDATOR), 'plan_registry.py'), 'get'], { stdio: 'ignore' });
  if (r.error) return 'unknown';
  return r.status === 0 ? 'declared' : r.status === 1 ? 'missing' : 'unknown';
}

function tellCaptain() {
  const session = resolveSession('capitano');
  if (!session) return { status: 'team_off' };
  const sent = sendMessage(session, PROFILE_READY_MESSAGE);
  return sent.ok ? { status: 'sent' } : { status: 'failed', detail: sent.error };
}

// stdin, bounded: the host wrapper hands the person's file over here.
function readStdin(maxBytes) {
  const chunks = [];
  let total = 0;
  const chunk = Buffer.alloc(8192);
  for (;;) {
    let n;
    try { n = readSync(0, chunk, 0, chunk.length, null); } catch (err) {
      if (err?.code === 'EAGAIN') continue;
      if (err?.code === 'EOF') break;
      throw err;
    }
    if (n === 0) break;
    total += n;
    if (total > maxBytes) return Buffer.alloc(maxBytes + 1);
    chunks.push(Buffer.from(chunk.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

// `validate --stdin`: the host wrapper hands the person's file over here, as it does for
// import (the container cannot see host paths). Same bound as the import; the validator
// reads a private copy that is gone when it answers. Nothing is written to the profile.
function validateStdin(file, opts) {
  if (file) {
    console.error('Usage: jht profile validate [file.yml] [--strict] [--json]   (a file or --stdin, not both)');
    process.exitCode = 2;
    return;
  }
  let bytes;
  try { bytes = readStdin(MAX_PROFILE_BYTES); } catch { bytes = null; }
  const refuse = (code) => {
    if (opts.json) console.log(JSON.stringify({ ok: false, errors: [IMPORT_SAYS[code]], warnings: [] }));
    else console.error(`ERROR: ${IMPORT_SAYS[code]}`);
    process.exitCode = 1;
  };
  if (!bytes) return refuse('profile_unreadable');
  if (bytes.length > MAX_PROFILE_BYTES) return refuse('profile_too_large');
  if (bytes.length === 0) return refuse('profile_empty');
  const dir = mkdtempSync(join(tmpdir(), 'jht-profile-validate-'));
  try {
    const copy = join(dir, 'candidate_profile.yml');
    writeFileSync(copy, bytes, { mode: 0o600 });
    if (!existsSync(VALIDATOR)) {
      console.error(`: validator not found: ${VALIDATOR}`);
      process.exitCode = 2;
      return;
    }
    const args = [VALIDATOR, copy];
    if (opts.strict) args.push('--strict');
    if (opts.json) args.push('--json');
    const r = spawnSync('python3', args, { encoding: 'utf8' });
    if (r.error) {
      console.error(`: impossible to run python3: ${r.error.message}`);
      process.exitCode = 2;
      return;
    }
    // The validator names the file it read (a YAML error quotes it): that was a copy that is
    // gone now, so the person is told it was the standard input.
    const seen = (text) => [copy, dir].reduce(
      (out, path) => out.split(path).join('<stdin>').split(JSON.stringify(path).slice(1, -1)).join('<stdin>'),
      text ?? '',
    );
    process.stdout.write(seen(r.stdout));
    process.stderr.write(seen(r.stderr));
    process.exitCode = r.status ?? 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const IMPORT_SAYS = {
  profile_empty: 'the profile file is empty',
  profile_too_large: `the profile file is larger than ${MAX_PROFILE_BYTES / 1024} KiB`,
  profile_invalid: 'the profile is not complete enough for the team to start (nothing was written)',
  profile_review_pending: 'a profile review is waiting for your confirmation in the app: confirm or discard it first',
  profile_exists: 'a profile already exists: use --replace to replace it (the one replaced is kept as candidate_profile.yml.prev)',
  profile_target_unsafe: 'the profile path is a link or not a regular file: nothing was written',
  validator_unavailable: 'the profile validator cannot run (python3 or its module): nothing was written',
  ready_flag_missing: 'the profile was written but ready.flag could not be created: run the import again with --replace',
  profile_unreadable: 'the profile file cannot be read: it must be a regular file, not a link',
};

function importAction(file, opts) {
  const fail = (code, extra = {}) => {
    if (opts.json) console.log(JSON.stringify({ ok: false, code, ...extra }));
    else {
      console.error(`Error: ${IMPORT_SAYS[code] ?? code}`);
      for (const line of extra.errors ?? []) console.error(`  ${line}`);
    }
    process.exitCode = 1;
  };
  if ((file && opts.stdin) || (!file && !opts.stdin)) {
    console.error('Usage: jht profile import <file.yml> [--replace] [--json]');
    process.exitCode = 2;
    return;
  }
  let bytes;
  try {
    bytes = opts.stdin ? readStdin(MAX_PROFILE_BYTES) : readRegularFile(file, { maxBytes: MAX_PROFILE_BYTES });
  } catch (err) {
    return fail(err?.code === 'EFBIG' ? 'profile_too_large' : 'profile_unreadable');
  }
  let result;
  try {
    result = importProfile({
      bytes, replace: opts.replace === true, profileDir: JHT_PROFILE_DIR,
      validate: validateStrict, reviewPending, notify: tellCaptain, planDeclared,
    });
  } catch (err) {
    console.error(`Error: the profile could not be written (${err?.code || 'error'})`);
    process.exitCode = 1;
    return;
  }
  if (!result.ok) return fail(result.code, result);
  if (opts.json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log('Profile imported and ready.');
  if (result.previousKept) console.log(`The profile it replaced was kept, private, as ${result.previousKept} next to it.`);
  if (result.captain === 'sent') console.log('The Capitano has been told: the team starts.');
  else if (result.captain === 'team_off') console.log('The team is not running: the Capitano will start it from this profile at its next wake. Start the team with: jht team start');
  else console.log(`The Capitano could not be told now (${result.detail ?? 'delivery failed'}): it finds the profile at its next wake.`);
  if (result.plan === 'missing') {
    console.log('No subscription plan is declared, and the Capitano does not open the first run without one.');
    console.log('See the plans and declare yours with: jht providers plan   (then: jht providers plan <id>)');
  }
}

export function registerProfileCommand(program) {
  const cmd = new Command('profile').description('Candidate profile (candidate_profile.yml)');

  cmd
    .command('validate [file]')
    .description('Validate the profile against the canonical schema (default: $JHT_HOME/profile/candidate_profile.yml)')
    .option('--strict', 'also treat warnings (legacy lists) as errors')
    .option('--stdin', 'read the profile from standard input (the host wrapper uses it for a file on the host)')
    .option('--json', 'output JSON {ok, errors, warnings}')
    .action(validateAction);

  cmd
    .command('import [file]')
    .description('Give the team its candidate profile: validate it, write it privately and atomically, mark it ready and tell the Capitano')
    .option('--stdin', 'read the profile from standard input (the host wrapper uses it)')
    .option('--replace', 'replace the profile that already exists (the one replaced is kept as candidate_profile.yml.prev)')
    .option('--json', 'output JSON {ok, code, …}')
    .action(importAction);

  // default: `jht profile` → valida il profilo del workspace
  cmd.action(() => validateAction(undefined, {}));

  program.addCommand(cmd);
}
