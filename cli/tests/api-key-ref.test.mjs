import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasKeyRef, isKeyVariable, validateConfigBeforeWrite } from '../wizard/setup-helpers.js';

// The key can live in a file or in an environment variable (`api_key_ref`): the setup must finish with it, and the
// config keeps the reference, never the key. The launcher resolves the reference at every start
// (tests/test_key_ref_launcher.py).
const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

const config = (provider) => ({
  version: 1,
  active_provider: 'openai',
  providers: { openai: { name: 'openai', auth_method: 'api_key', model: 'gpt-5.6-sol', ...provider } },
});

test('a reference to a file or to a variable stands in for the key', () => {
  for (const api_key_ref of [
    { type: 'ref', source: 'file', path: '/run/secrets/openai' },
    { type: 'ref', source: 'env', id: 'OPENAI_API_KEY' },
    { type: 'ref', source: 'exec', command: 'secret-tool lookup jht' },
  ]) {
    assert.deepEqual(validateConfigBeforeWrite(config({ api_key_ref })), { success: true, errors: [] });
  }
});

test('a key or nothing at all is judged as before', () => {
  assert.equal(validateConfigBeforeWrite(config({ api_key: 'plain-but-present' })).success, true);
  const none = validateConfigBeforeWrite(config({}));
  assert.equal(none.success, false);
  assert.match(none.errors[0], /api_key is required/);
});

test('a reference that does not point anywhere does not count', () => {
  for (const api_key_ref of [
    null, 'file:/x', {}, { type: 'plaintext', value: 'x' },
    { type: 'ref', source: 'file' }, { type: 'ref', source: 'file', path: '' },
    { type: 'ref', source: 'env', id: '1BAD' }, { type: 'ref', source: 'env', id: 'has space' },
    { type: 'ref', source: 'exec', command: '' }, { type: 'ref', source: 'vault', id: 'x' },
  ]) {
    assert.equal(hasKeyRef(api_key_ref), false, JSON.stringify(api_key_ref));
    assert.equal(validateConfigBeforeWrite(config({ api_key_ref })).success, false, JSON.stringify(api_key_ref));
  }
});

function setup(args, env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jht-keyref-'));
  const done = spawnSync(process.execPath, [entry, 'setup', '--non-interactive', '--provider', 'openai', '--skip-health', ...args], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, JHT_HOME: home, JHT_LANG: 'en', ...env },
  });
  const path = join(home, 'jht.config.json');
  return { done, config: existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null, raw: existsSync(path) ? readFileSync(path, 'utf8') : '' };
}

// Invented, from parts: never a real key.
const KEY = ['fixture', 'not', 'a', 'real', 'key'].join('-');

test('jht setup --secret-mode file finishes and writes the path, not the key', () => {
  const { done, config: written, raw } = setup(['--secret-mode', 'file', '--secret-file', '/dev/shm/jht-run-key']);
  assert.equal(done.status, 0, done.stderr + done.stdout);
  assert.doesNotMatch(done.stderr, /api_key is required/);
  assert.deepEqual(written.providers.openai.api_key_ref, { type: 'ref', source: 'file', path: '/dev/shm/jht-run-key' });
  assert.equal(written.providers.openai.api_key, undefined);
  assert.equal(raw.includes(KEY), false);
});

test('jht setup --secret-mode env finishes and writes the name of the variable, not the key', () => {
  const { done, config: written, raw } = setup(['--secret-mode', 'env', '--secret-env', 'MY_RUN_KEY'], { MY_RUN_KEY: KEY });
  assert.equal(done.status, 0, done.stderr + done.stdout);
  assert.deepEqual(written.providers.openai.api_key_ref, { type: 'ref', source: 'env', id: 'MY_RUN_KEY' });
  assert.equal(raw.includes(KEY), false);
});

test('without --secret-file the file mode still says what is missing', () => {
  const { done } = setup(['--secret-mode', 'file']);
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /--secret-file is required/);
});

test('only a key variable can be named: not a path, a service secret or a launcher variable', () => {
  for (const ok of ['OPENAI_API_KEY', 'MY_RUN_KEY', 'run_key']) assert.equal(isKeyVariable(ok), true, ok);
  for (const bad of ['PATH', 'HOME', 'FLEETD_TOKEN', 'JHT_SECRET_KEY', 'SUPABASE_SERVICE_KEY', 'TELEGRAM_BOT_KEY', 'NEXT_PUBLIC_KEY',
    'LD_PRELOAD_KEY', 'has space', '1KEY', '', null, 'X'.repeat(70) + '_KEY']) {
    assert.equal(isKeyVariable(bad), false, String(bad));
    assert.equal(hasKeyRef({ type: 'ref', source: 'env', id: bad }), false, String(bad));
  }
});
