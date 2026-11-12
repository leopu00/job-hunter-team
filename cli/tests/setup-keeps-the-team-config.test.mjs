// `jht setup --non-interactive --provider glm|kimi --harness pi --api-key-stdin` for a team that is already on that provider: the new key
// replaces the old one and nothing else of the config is lost (the channels, the model chosen, the other fields). Made-up homes and keys.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { offeredInRelease } from '../../shared/runtime/release-providers.js';
const kimiSkip = offeredInRelease('kimi') ? false : 'kimi is not offered in this release (shared/runtime/release-providers.js)';

const HOME = mkdtempSync(join(tmpdir(), 'jht-keep-config-'));
const DEPS = join(HOME, 'deps');
process.env.JHT_HOME = join(HOME, 'home');
process.env.JHT_DEPS_PREFIX = DEPS;
mkdirSync(process.env.JHT_HOME);
const { runNonInteractiveSetup, sameTeamConfig } = await import('../wizard/setup-noninteractive.js');

const KEY = ['synthetic', 'value', 'ab'.repeat(10)].join('-');
const CONFIG = join(process.env.JHT_HOME, 'jht.config.json');
const piped = (text) => Readable.from([Buffer.from(text)]);

async function setup(opts, status = 200) {
  const out = [];
  const log = console.log; const error = console.error; const realFetch = globalThis.fetch;
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  globalThis.fetch = async () => ({ status, ok: status >= 200 && status < 300 });
  process.exitCode = 0;
  try { await runNonInteractiveSetup({ language: 'en', authMethod: 'api_key', harness: 'pi', provider: 'glm', apiKeyStdin: true, stdin: piped(`${KEY}\n`), ...opts }); }
  finally { console.log = log; console.error = error; globalThis.fetch = realFetch; }
  const code = process.exitCode; process.exitCode = 0;
  return { code, text: out.join('\n') };
}
const read = () => JSON.parse(readFileSync(CONFIG, 'utf8'));
const TELEGRAM = { telegram: { bots: { capitano: { token_ref: { type: 'ref', source: 'env', id: 'TG_CAPITANO' } } } } };
const before = (over = {}) => ({
  version: 1,
  active_provider: 'glm',
  providers: { glm: { name: 'glm', auth_method: 'api_key', model: 'glm-chosen-before', api_key_ref: { type: 'ref', source: 'file', path: '/opt/jht-deps/keys/glm.key' } } },
  channels: TELEGRAM,
  harness: 'pi',
  work_hours: { start: '09:00', end: '18:00' },
  ...over,
});
const put = (config) => { rmSync(join(DEPS, 'keys'), { recursive: true, force: true }); writeFileSync(CONFIG, JSON.stringify(config)); };

test('a new key for the team that is already on that provider keeps the channels, the model and the other fields', async () => {
  put(before());
  const { code, text } = await setup({});
  assert.equal(code, 0, text);
  const saved = read();
  assert.deepEqual(saved.channels, TELEGRAM, 'the Telegram bots are still there');
  assert.equal(saved.providers.glm.model, 'glm-chosen-before', 'the model chosen before is kept when none is given');
  assert.deepEqual(saved.work_hours, { start: '09:00', end: '18:00' });
  assert.equal(saved.active_provider, 'glm');
  assert.equal(saved.harness, 'pi');
  assert.equal(saved.providers.glm.auth_method, 'api_key');
  assert.deepEqual(saved.providers.glm.api_key_ref, { type: 'ref', source: 'file', path: join(DEPS, 'keys', 'glm.key') });
  assert.equal(readFileSync(join(DEPS, 'keys', 'glm.key'), 'utf8'), `${KEY}\n`);
  assert.ok(!readFileSync(CONFIG, 'utf8').includes(KEY));
});

test('a model given now replaces the one chosen before; a plaintext key or a subscription of the old entry does not survive', async () => {
  put(before({ providers: { glm: { name: 'glm', auth_method: 'api_key', model: 'glm-chosen-before', api_key: 'old-plaintext', subscription: { email: 'user@example.com' } } } }));
  const { code, text } = await setup({ model: 'glm-new' });
  assert.equal(code, 0, text);
  const entry = read().providers.glm;
  assert.equal(entry.model, 'glm-new');
  assert.equal(entry.api_key, undefined);
  assert.equal(entry.subscription, undefined);
  assert.ok(entry.api_key_ref);
});

test('a config that says moonshot is the team of kimi: kept, and the entry moves to the name the setup writes', { skip: kimiSkip }, async () => {
  put({
    version: 1,
    active_provider: 'moonshot',
    providers: { moonshot: { name: 'moonshot', auth_method: 'api_key', model: 'kimi-chosen-before', api_key: 'old-plaintext' }, glm: { name: 'glm', auth_method: 'api_key', model: 'glm-other', api_key_ref: { type: 'ref', source: 'env', id: 'ZAI_API_KEY' } } },
    channels: TELEGRAM,
    harness: 'pi',
  });
  const { code, text } = await setup({ provider: 'kimi' });
  assert.equal(code, 0, text);
  const saved = read();
  assert.equal(saved.active_provider, 'kimi');
  assert.deepEqual(saved.channels, TELEGRAM);
  assert.equal(saved.providers.kimi.model, 'kimi-chosen-before');
  assert.equal(saved.providers.kimi.api_key, undefined);
  assert.equal(saved.providers.moonshot, undefined, 'no entry left under the old name');
  assert.equal(saved.providers.glm.model, 'glm-other', 'the other providers keep their entries');
  assert.equal(sameTeamConfig({ active_provider: 'kimi', harness: 'pi', providers: { kimi: {} } }, 'moonshot', 'pi'), null, 'the setup names kimi');
});

test('another provider or another harness starts a new config, as before', { skip: kimiSkip }, async () => {
  put(before());
  const other = await setup({ provider: 'kimi' });
  assert.equal(other.code, 0, other.text);
  assert.deepEqual(read().channels, {});
  assert.equal(read().active_provider, 'kimi');
  assert.equal(read().work_hours, undefined);
  put(before({ harness: undefined }));   // no harness = codex: glm cannot be that, but the rule is about the harness of the team
  assert.equal(sameTeamConfig(JSON.parse(readFileSync(CONFIG, 'utf8')), 'glm', 'pi'), null);
});

test('a key the provider refuses leaves the config as it was, and the exit says so (3)', async () => {
  put(before());
  const snapshot = readFileSync(CONFIG, 'utf8');
  const { code, text } = await setup({}, 401);
  assert.equal(code, 3, text);
  assert.equal(readFileSync(CONFIG, 'utf8'), snapshot);
  assert.equal(existsSync(join(DEPS, 'keys')), false);
  assert.ok(!text.includes(KEY));
});

test('no config yet, or one that cannot be read, is a new config', async () => {
  rmSync(CONFIG, { force: true });
  assert.equal((await setup({})).code, 0);
  assert.deepEqual(read().channels, {});
  put(before());
  writeFileSync(CONFIG, '{not json');
  assert.equal((await setup({})).code, 0);
  assert.deepEqual(read().channels, {});
  for (const bad of [null, [], 'x', { active_provider: 'glm' }, { active_provider: 'glm', providers: { glm: 3 } }]) {
    assert.equal(sameTeamConfig(bad, 'glm', 'pi'), null);
  }
});
