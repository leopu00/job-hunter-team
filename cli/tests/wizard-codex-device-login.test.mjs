import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodexDeviceLogin, recordLoginFailure } from '../wizard/codex-device-login.js';
import { runProviderLoginStep } from '../wizard/provider-login.js';
import { t, tf } from '../wizard/i18n.js';

function terminal({ raw = true, paused = false } = {}) {
  const events = [];
  return {
    events, isTTY: true, isRaw: raw, isPaused: () => paused,
    pause: () => events.push('pause'), resume: () => events.push('resume'),
    setRawMode: (value) => events.push(['raw', value]),
  };
}

function step(overrides = {}) {
  const notes = [];
  const failures = [];
  const options = {
    cmdName: 'codex', label: 'Codex', isVps: false, t, tf,
    prompter: { note: async (body, title) => notes.push({ body, title }),
      progress: () => assert.fail('no spinner may overwrite the device code') },
    wait: () => assert.fail('Codex must not wait for another terminal'),
    report: (...args) => failures.push(args), find: () => null,
    ...overrides,
  };
  return { options, notes, failures };
}

test('the real device command inherits all three descriptors and lends a cooked terminal, then restores it', () => {
  const stdin = terminal();
  const env = { HOME: '/synthetic/home' };
  const result = runCodexDeviceLogin({ stdin, env, spawn: (cmd, args, opts) => {
    assert.equal(cmd, 'codex');
    assert.deepEqual(args, ['login', '--device-auth']);
    assert.equal(opts.stdio, 'inherit');
    assert.equal(opts.env, env);
    assert.equal(opts.timeout, 30 * 60 * 1000);
    assert.deepEqual(stdin.events, ['pause', ['raw', false]]);
    return { status: 0 };
  } });
  assert.equal(result.status, 0);
  assert.deepEqual(stdin.events, ['pause', ['raw', false], ['raw', true], 'resume']);
});

test('spawn failure restores raw mode and leaves an originally paused input paused', () => {
  const stdin = terminal({ paused: true });
  assert.throws(() => runCodexDeviceLogin({ stdin, spawn: () => { throw new Error('synthetic'); } }), /synthetic/);
  assert.deepEqual(stdin.events, ['pause', ['raw', false], ['raw', true]]);
});

test('redirected input works without requesting TTY methods', () => {
  const stdin = { isTTY: false, isPaused: () => true, pause() {} };
  assert.equal(runCodexDeviceLogin({ stdin, spawn: () => ({ status: 0 }) }).status, 0);
});

for (const isVps of [false, true]) {
  test(`Codex signs in here and verifies the new marker (VPS=${isVps})`, async () => {
    let signedIn = false;
    const subject = step({ isVps, find: () => signedIn ? '/synthetic/.codex/auth.json' : null,
      login: () => { signedIn = true; return { status: 0 }; } });
    assert.equal(await runProviderLoginStep(subject.options), '/synthetic/.codex/auth.json');
    assert.match(subject.notes[0].body, /in this terminal/);
    assert.match(subject.notes[0].body, /URL.*device code/);
    assert.match(subject.notes[0].body, /Waiting here/);
    assert.match(subject.notes[0].body, /Ctrl-C.*jht setup/);
    assert.doesNotMatch(subject.notes[0].title, /another terminal/);
    assert.match(subject.notes.at(-1).body, /detected/);
    assert.deepEqual(subject.failures, []);
  });
}

test('an existing login skips the child and has no instruction about another terminal', async () => {
  const subject = step({ find: () => '/synthetic/.codex/auth.json', login: () => assert.fail('already signed in') });
  assert.equal(await runProviderLoginStep(subject.options), '/synthetic/.codex/auth.json');
  assert.doesNotMatch(subject.notes[0].title, /another terminal/);
});

for (const result of [{ status: 1 }, { status: null, signal: 'SIGINT' }, { status: 0, error: new Error('synthetic') }]) {
  test(`failed Codex exit does not continue: ${JSON.stringify(result)}`, async () => {
    const subject = step({ login: () => result });
    assert.equal(await runProviderLoginStep(subject.options), null);
    assert.match(subject.notes.at(-1).body, /codex_login_failed:.*jht setup/);
    assert.equal(subject.failures[0][0], 'codex_login_failed');
    assert.equal(subject.notes.some(({ body }) => /detected/.test(body)), false);
  });
}

test('exit zero without credentials is a logged failure rather than a completed login', async () => {
  const subject = step({ login: () => ({ status: 0 }) });
  assert.equal(await runProviderLoginStep(subject.options), null);
  assert.equal(subject.failures[0][0], 'codex_login_missing');
  assert.match(subject.notes.at(-1).body, /not found.*jht setup/);
});

test('a missing executable is reported without leaking exception details', async () => {
  const subject = step({ login: () => { throw new Error('synthetic-private-child-detail'); } });
  assert.equal(await runProviderLoginStep(subject.options), null);
  assert.match(subject.notes.at(-1).body, /codex_login_failed/);
  assert.doesNotMatch(JSON.stringify(subject.notes), /private-child-detail/);
});

test('an unavailable failure log is visible and never turns the login into a success', async () => {
  const subject = step({ login: () => ({ status: 1 }), report: () => { throw new Error('synthetic'); } });
  assert.equal(await runProviderLoginStep(subject.options), null);
  assert.match(subject.notes.at(-2).body, /codex_login_log_unavailable:.*runtime.log/);
});

test('runtime.log contains the closed error and refuses a symlink without changing its target', (ctx) => {
  const root = mkdtempSync(join(tmpdir(), 'jht-codex-errors-'));
  ctx.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'logs');
  recordLoginFailure('codex_login_failed', 'Synthetic failure', { dir });
  assert.match(readFileSync(join(dir, 'runtime.log'), 'utf8'), /codex_login_failed: Synthetic failure/);
  const target = join(root, 'target');
  writeFileSync(target, 'synthetic sentinel');
  const linked = join(root, 'linked');
  mkdirSync(linked);
  symlinkSync(target, join(linked, 'runtime.log'));
  assert.throws(() => recordLoginFailure('codex_login_failed', 'Synthetic failure', { dir: linked }));
  assert.equal(readFileSync(target, 'utf8'), 'synthetic sentinel');
});
