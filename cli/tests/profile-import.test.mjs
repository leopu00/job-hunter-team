import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { MAX_PROFILE_BYTES, PROFILE_READY_MESSAGE, importProfile } from '../src/lib/profile-import.js';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/profile-synthetic.yml');
const PROFILE = readFileSync(FIXTURE);

function folder() {
  const root = mkdtempSync(join(tmpdir(), 'jht-profile-import-'));
  return { root, dir: join(root, 'profile') };
}

// The doubles stand for what the command wires in; each one records that it was asked.
function deps(dir, over = {}) {
  const asked = { validate: [], notify: 0 };
  return {
    asked,
    args: {
      profileDir: dir,
      bytes: PROFILE,
      validate: (path) => { asked.validate.push(path); return { ok: true }; },
      reviewPending: () => false,
      notify: () => { asked.notify += 1; return { status: 'sent' }; },
      now: () => new Date('2026-10-27T01:02:03.456Z'),
      ...over,
    },
  };
}

const left = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);

test('a valid profile is written privately, marked ready, and the Capitano is told once, in that order', () => {
  const { dir } = folder();
  const { args, asked } = deps(dir, {
    notify: () => {
      // Told only when both the profile and the flag are on the disk.
      assert.deepEqual(left(dir), ['candidate_profile.yml', 'ready.flag']);
      asked.notify += 1;
      return { status: 'sent' };
    },
  });
  const result = importProfile(args);
  assert.deepEqual(result, { ok: true, profileWritten: true, readyFlag: true, captain: 'sent' });
  assert.equal(asked.notify, 1);
  assert.deepEqual(readFileSync(join(dir, 'candidate_profile.yml')), PROFILE);
  assert.equal(readFileSync(join(dir, 'ready.flag'), 'utf8'), '2026-10-27T01:02:03Z\n');
  assert.equal(lstatSync(join(dir, 'candidate_profile.yml')).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(dir, 'ready.flag')).mode & 0o777, 0o600);
  // Validated where it was staged, never the file the person pointed at, and no stage is left.
  assert.match(asked.validate[0], /\.candidate_profile\.yml\.[^/]*\.stage$/);
  assert.deepEqual(left(dir), ['candidate_profile.yml', 'ready.flag']);
});

test('a profile that does not validate writes nothing, marks nothing, tells nobody', () => {
  const { dir } = folder();
  const { args, asked } = deps(dir, { validate: () => ({ ok: false, errors: ['languages[0].level: required'] }) });
  assert.deepEqual(importProfile(args), { ok: false, code: 'profile_invalid', errors: ['languages[0].level: required'] });
  assert.deepEqual(left(dir), []);
  assert.equal(asked.notify, 0);
});

test('a validator that cannot run is not a valid profile', () => {
  const { dir } = folder();
  const { args, asked } = deps(dir, { validate: () => ({ ok: false, unavailable: true }) });
  assert.equal(importProfile(args).code, 'validator_unavailable');
  assert.deepEqual(left(dir), []);
  assert.equal(asked.notify, 0);
});

test('an existing profile is kept unless the person asks to replace it', () => {
  const { dir } = folder();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'candidate_profile.yml'), 'name: Old\n');
  const first = deps(dir);
  assert.equal(importProfile(first.args).code, 'profile_exists');
  assert.equal(readFileSync(join(dir, 'candidate_profile.yml'), 'utf8'), 'name: Old\n');
  assert.equal(first.asked.notify, 0);
  assert.deepEqual(left(dir), ['candidate_profile.yml']);

  const second = deps(dir, {});
  assert.equal(importProfile({ ...second.args, replace: true }).ok, true);
  assert.deepEqual(readFileSync(join(dir, 'candidate_profile.yml')), PROFILE);
});

test('a link or a pipe where the profile goes is never written through nor replaced', () => {
  const { root, dir } = folder();
  mkdirSync(dir, { recursive: true });
  const outside = join(root, 'outside.txt');
  writeFileSync(outside, 'untouched');
  symlinkSync(outside, join(dir, 'candidate_profile.yml'));
  for (const replace of [false, true]) {
    const { args, asked } = deps(dir);
    assert.equal(importProfile({ ...args, replace }).code, 'profile_target_unsafe');
    assert.equal(asked.notify, 0);
  }
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
  assert.equal(lstatSync(join(dir, 'candidate_profile.yml')).isSymbolicLink(), true);
  assert.ok(!existsSync(join(dir, 'ready.flag')));

  const pipes = folder();
  mkdirSync(pipes.dir, { recursive: true });
  execFileSync('mkfifo', [join(pipes.dir, 'candidate_profile.yml')]);
  const piped = deps(pipes.dir);
  assert.equal(importProfile({ ...piped.args, replace: true }).code, 'profile_target_unsafe');
  assert.equal(piped.asked.notify, 0);
});

test('a link planted where the validation ends is refused at the last look', () => {
  const { root, dir } = folder();
  const outside = join(root, 'outside.txt');
  writeFileSync(outside, 'untouched');
  const { args, asked } = deps(dir, {
    validate: () => { symlinkSync(outside, join(dir, 'candidate_profile.yml')); return { ok: true }; },
  });
  assert.equal(importProfile({ ...args, replace: true }).code, 'profile_target_unsafe');
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
  assert.equal(asked.notify, 0);
  assert.deepEqual(left(dir), ['candidate_profile.yml']); // the planted link only; the stage is gone
});

test('a link at ready.flag is replaced by the flag, not followed', () => {
  const { root, dir } = folder();
  mkdirSync(dir, { recursive: true });
  const outside = join(root, 'outside.txt');
  writeFileSync(outside, 'untouched');
  symlinkSync(outside, join(dir, 'ready.flag'));
  const { args } = deps(dir);
  assert.equal(importProfile(args).ok, true);
  assert.equal(readFileSync(outside, 'utf8'), 'untouched');
  assert.equal(lstatSync(join(dir, 'ready.flag')).isFile(), true);
});

test('a profile review waiting for the person blocks the import before anything is written', () => {
  const { dir } = folder();
  const { args, asked } = deps(dir, { reviewPending: () => true });
  assert.equal(importProfile(args).code, 'profile_review_pending');
  assert.deepEqual(left(dir), []);
  assert.deepEqual(asked.validate, []);
  assert.equal(asked.notify, 0);
});

test('an empty, binary or oversize file is refused as it is, before the validator', () => {
  const { dir } = folder();
  for (const [bytes, code] of [
    [Buffer.alloc(0), 'profile_empty'],
    [Buffer.from('name: x\0\n'), 'profile_invalid'],
    [Buffer.alloc(MAX_PROFILE_BYTES + 1, 97), 'profile_too_large'],
  ]) {
    const { args, asked } = deps(dir, { bytes });
    assert.equal(importProfile(args).code, code);
    assert.deepEqual(asked.validate, []);
  }
  assert.deepEqual(left(dir), []);
});

test('the Capitano out of reach does not undo the import, and the result says so', () => {
  const { dir } = folder();
  const off = deps(dir, { notify: () => ({ status: 'team_off' }) });
  assert.equal(importProfile(off.args).captain, 'team_off');
  const failed = deps(dir, { notify: () => ({ status: 'failed', detail: 'agent is busy' }) });
  assert.deepEqual(importProfile({ ...failed.args, replace: true }), {
    ok: true, profileWritten: true, readyFlag: true, captain: 'failed', detail: 'agent is busy',
  });
  assert.deepEqual(left(dir), ['candidate_profile.yml', 'ready.flag']);
});

// The real command, with the real validator, in a home of its own.
// (The command alone, as the CLI registers it: the whole program needs packages a test folder may lack.)
const RUNNER = `
import { Command } from 'commander';
import { registerProfileCommand } from ${JSON.stringify(resolve(import.meta.dirname, '../src/commands/profile.js'))};
const program = new Command();
registerProfileCommand(program);
await program.parseAsync(process.argv.slice(1), { from: 'user' });
`;

function run(home, args, input) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER, ...args], {
    encoding: 'utf8', input, timeout: 60000, cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, JHT_HOME: home, JHT_LANG: 'en', PATH: process.env.PATH },
  });
}

test('jht profile import: from a file and from stdin, with the real validator', { skip: spawnSync('python3', ['-c', 'import yaml']).status !== 0 }, () => {
  const fromFile = folder();
  const done = run(fromFile.root, ['profile', 'import', FIXTURE, '--json']);
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(JSON.parse(done.stdout), { ok: true, profileWritten: true, readyFlag: true, captain: 'team_off' });
  const profile = join(fromFile.root, 'profile', 'candidate_profile.yml');
  assert.deepEqual(readFileSync(profile), PROFILE);
  assert.match(readFileSync(join(fromFile.root, 'profile', 'ready.flag'), 'utf8'), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/);
  // The same profile again is refused, and --replace takes it.
  assert.equal(run(fromFile.root, ['profile', 'import', FIXTURE]).status, 1);
  assert.equal(run(fromFile.root, ['profile', 'import', FIXTURE, '--replace']).status, 0);

  const fromStdin = folder();
  const piped = run(fromStdin.root, ['profile', 'import', '--stdin', '--json'], PROFILE);
  assert.equal(piped.status, 0, piped.stderr);
  assert.deepEqual(readFileSync(join(fromStdin.root, 'profile', 'candidate_profile.yml')), PROFILE);
});

test('jht profile import: an invalid profile, a link and a big file are refused with nothing written', { skip: spawnSync('python3', ['-c', 'import yaml']).status !== 0 }, () => {
  const { root } = folder();
  const bad = join(root, 'bad.yml');
  writeFileSync(bad, 'name: Only A Name\n');
  const invalid = run(root, ['profile', 'import', bad, '--json']);
  assert.equal(invalid.status, 1);
  const verdict = JSON.parse(invalid.stdout);
  assert.equal(verdict.code, 'profile_invalid');
  assert.ok(verdict.errors.length > 0);

  const link = join(root, 'link.yml');
  symlinkSync(FIXTURE, link);
  assert.equal(JSON.parse(run(root, ['profile', 'import', link, '--json']).stdout).code, 'profile_unreadable');

  const big = join(root, 'big.yml');
  writeFileSync(big, Buffer.alloc(MAX_PROFILE_BYTES + 1, 97));
  assert.equal(JSON.parse(run(root, ['profile', 'import', big, '--json']).stdout).code, 'profile_too_large');
  const huge = run(root, ['profile', 'import', '--stdin', '--json'], Buffer.alloc(MAX_PROFILE_BYTES * 3, 97));
  assert.equal(JSON.parse(huge.stdout).code, 'profile_too_large');

  assert.ok(!existsSync(join(root, 'profile', 'candidate_profile.yml')));
  assert.ok(!existsSync(join(root, 'profile', 'ready.flag')));
  assert.equal(run(root, ['profile', 'import']).status, 2);
});

// The Capitano is reached by the transport `jht team send` uses; the stubs stand for tmux and
// jht-tmux-send, and for a docker that finds no container, so no real session is ever touched.
function stubbedTools(sendExit) {
  const bin = mkdtempSync(join(tmpdir(), 'jht-stub-bin-'));
  const sent = join(bin, 'sent.txt');
  const tool = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  tool('docker', 'exit 1');
  tool('tmux', 'echo JHT-CAPITANO');
  tool('jht-tmux-send', `printf '%s\\n%s\\n' "$1" "$2" > '${sent}'; exit ${sendExit}`);
  return { bin, sent };
}

test('jht profile import tells the Capitano through the transport, and says so when it cannot', { skip: spawnSync('python3', ['-c', 'import yaml']).status !== 0 }, () => {
  const python = execFileSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim();
  for (const [exit, captain] of [[0, 'sent'], [4, 'failed']]) {
    const { root } = folder();
    const { bin, sent } = stubbedTools(exit);
    const path = `${bin}:${resolve(python, '..')}:/usr/bin:/bin`;
    const done = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER, 'profile', 'import', FIXTURE, '--json'], {
      encoding: 'utf8', timeout: 60000, cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, JHT_HOME: root, JHT_LANG: 'en', PATH: path },
    });
    assert.equal(done.status, 0, done.stderr);
    assert.equal(JSON.parse(done.stdout).captain, captain);
    // Said once, to the Capitano, in the person's console voice: no borrowed envelope.
    assert.deepEqual(readFileSync(sent, 'utf8').split('\n').slice(0, 2), ['JHT-CAPITANO', PROFILE_READY_MESSAGE]);
    assert.ok(!PROFILE_READY_MESSAGE.startsWith('[@'));
    assert.ok(!/['"$`\\]/.test(PROFILE_READY_MESSAGE), 'nothing the transport quoting would have to escape');
  }
});

test('the module is the only place that writes the profile and the flag', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../src/lib/profile-import.js'), 'utf8');
  assert.ok(!/writeFileSync|appendFileSync|copyFileSync/.test(source), 'staged O_EXCL files and renames only');
  assert.equal(execFileSync('node', ['--check', resolve(import.meta.dirname, '../src/commands/profile.js')]).length, 0);
});
