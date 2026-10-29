// `jht setup` and the provider login: a login that is already there ends the step, without waiting and without
// telling the person to log in; the text for this computer does not speak of a VPS.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { findProviderLogin, loginHomes, runProviderLoginStep, waitForProviderLogin } from '../wizard/provider-login.js';

const LOCALES = resolve(import.meta.dirname, '../../shared/locales');
const LANGS = ['it', 'en', 'de', 'fr', 'es', 'hu', 'pt'];

function home(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-login-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function prompter() {
  const notes = [];
  const stops = [];
  return {
    notes, stops,
    note: async (body, title) => { notes.push({ body, title }); },
    progress: () => ({ stop: (message) => stops.push(message) }),
  };
}

const t = (key) => key;
const tf = (key, ...args) => `${key}(${args.join(',')})`;

test('the marker of each provider is the file the app and the team start ask for', () => {
  const dir = home({ '.codex/auth.json': '{}', '.claude/.credentials.json': '{}', '.kimi/credentials/kimi-code.json': '{}' });
  for (const [cmd, file] of [['codex', '.codex/auth.json'], ['claude', '.claude/.credentials.json'], ['kimi', '.kimi/credentials/kimi-code.json']]) {
    assert.equal(findProviderLogin(cmd, { homes: [dir] }), join(dir, file));
  }
  assert.equal(findProviderLogin('nobody', { homes: [dir] }), null);
  // the old name that Codex never wrote is not a login
  assert.equal(findProviderLogin('codex', { homes: [home({ '.codex/.credentials.json': '{}' })] }), null);
});

test('a login written long before the wizard began counts: the age of the file is not asked', () => {
  const dir = home({ '.codex/auth.json': '{"auth_mode":"chatgpt"}' });
  const old = new Date('2026-01-01T00:00:00Z');
  utimesSync(join(dir, '.codex/auth.json'), old, old);
  assert.equal(findProviderLogin('codex', { homes: [dir] }), join(dir, '.codex/auth.json'));
});

test('JHT_HOME is looked at too, after the two homes of the container', () => {
  assert.deepEqual(loginHomes({ JHT_HOME: '/x/.jht' }), ['/jht_home', '/home/jht', '/x/.jht']);
  assert.deepEqual(loginHomes({}), ['/jht_home', '/home/jht']);
});

test('with a login already there the step goes on at once: no instruction to log in, no waiting', async () => {
  const p = prompter();
  let waited = false;
  const found = await runProviderLoginStep({
    cmdName: 'codex', label: 'Codex (OpenAI)', isVps: false, prompter: p, t, tf,
    find: () => '/jht_home/.codex/auth.json',
    wait: async () => { waited = true; return null; },
  });
  assert.equal(found, '/jht_home/.codex/auth.json');
  assert.equal(waited, false);
  assert.equal(p.stops.length, 0);
  assert.equal(p.notes.length, 1);
  assert.match(p.notes[0].body, /wizard\.oauth\.detected/);
  assert.doesNotMatch(p.notes[0].body, /notify_body/);
});

test('without a login the person is told where to log in: SSH on a VPS, another terminal here on this computer', async () => {
  for (const [isVps, key] of [[true, 'wizard.oauth.notify_body('], [false, 'wizard.oauth.notify_body_local(']]) {
    const p = prompter();
    const found = await runProviderLoginStep({
      cmdName: 'codex', label: 'Codex (OpenAI)', isVps, prompter: p, t, tf,
      find: () => null,
      wait: async () => '/jht_home/.codex/auth.json',
    });
    assert.equal(found, '/jht_home/.codex/auth.json');
    assert.ok(p.notes[0].body.startsWith(key), p.notes[0].body);
    assert.match(p.stops[0], /wizard\.oauth\.detected/);
  }
});

test('a login that never comes ends the step with the timeout said', async () => {
  const p = prompter();
  const found = await runProviderLoginStep({
    cmdName: 'codex', label: 'Codex (OpenAI)', isVps: false, prompter: p, t, tf,
    find: () => null, wait: async () => null,
  });
  assert.equal(found, null);
  assert.deepEqual(p.stops, ['wizard.oauth.timeout']);
});

test('the wait ends when the marker shows up, and at the deadline when it does not', async () => {
  let calls = 0;
  const found = await waitForProviderLogin('codex', 60_000, {
    find: () => (++calls === 3 ? '/x/auth.json' : null), sleep: async () => {}, now: () => 0,
  });
  assert.equal(found, '/x/auth.json');
  let clock = 0;
  assert.equal(await waitForProviderLogin('codex', 10_000, { find: () => null, sleep: async () => { clock += 4000; }, now: () => clock }), null);
});

test('the text for this computer exists in the seven languages and does not send the person over SSH', () => {
  for (const lang of LANGS) {
    const texts = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8'));
    const local = texts['wizard.oauth.notify_body_local'];
    assert.equal(typeof local, 'string', lang);
    assert.doesNotMatch(local, /ssh|vps/i, lang);
    assert.match(local, /jht oauth-login/, lang);
    assert.equal((local.match(/%s/g) || []).length, (texts['wizard.oauth.notify_body'].match(/%s/g) || []).length, lang);
    assert.match(texts['wizard.oauth.notify_body'], /ssh/i, lang);
  }
});
