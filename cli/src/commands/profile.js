import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readSync } from 'node:fs';
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
  const r = spawnSync('python3', [VALIDATOR, path, '--strict', '--json'], { encoding: 'utf8' });
  if (r.error || r.status === 2) return { ok: false, unavailable: true };
  try {
    const out = JSON.parse(r.stdout);
    return { ok: out.ok === true, errors: [...(out.errors ?? []), ...(out.warnings ?? [])] };
  } catch {
    return { ok: false, errors: ['the validator gave no answer'] };
  }
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

const IMPORT_SAYS = {
  profile_empty: 'the profile file is empty',
  profile_too_large: `the profile file is larger than ${MAX_PROFILE_BYTES / 1024} KiB`,
  profile_invalid: 'the profile does not pass the validation (nothing was written)',
  profile_review_pending: 'a profile review is waiting for your confirmation in the app: confirm or discard it first',
  profile_exists: 'a profile already exists: use --replace to replace it',
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
      validate: validateStrict, reviewPending, notify: tellCaptain,
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
  if (result.captain === 'sent') console.log('The Capitano has been told: the team starts.');
  else if (result.captain === 'team_off') console.log('The team is not running: the Capitano will start it from this profile at its next wake. Start the team with: jht team start');
  else console.log(`The Capitano could not be told now (${result.detail ?? 'delivery failed'}): it finds the profile at its next wake.`);
}

export function registerProfileCommand(program) {
  const cmd = new Command('profile').description('Candidate profile (candidate_profile.yml)');

  cmd
    .command('validate [file]')
    .description('Validate the profile against the canonical schema (default: $JHT_HOME/profile/candidate_profile.yml)')
    .option('--strict', 'also treat warnings (legacy lists) as errors')
    .option('--json', 'output JSON {ok, errors, warnings}')
    .action(validateAction);

  cmd
    .command('import [file]')
    .description('Give the team its candidate profile: validate it, write it privately and atomically, mark it ready and tell the Capitano')
    .option('--stdin', 'read the profile from standard input (the host wrapper uses it)')
    .option('--replace', 'replace the profile that already exists')
    .option('--json', 'output JSON {ok, code, …}')
    .action(importAction);

  // default: `jht profile` → valida il profilo del workspace
  cmd.action(() => validateAction(undefined, {}));

  program.addCommand(cmd);
}
