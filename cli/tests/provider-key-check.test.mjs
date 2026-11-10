// A wrong API key of glm/kimi (pi) is said by the command, not only inside the Pi session of the first agent (D2 of the
// 10/11 CLI test): one light call to the provider, a refusal only on a 401, never a printed key. All keys here are invented.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const HOME = mkdtempSync(join(tmpdir(), 'jht-key-check-'));
process.env.JHT_HOME = HOME;
const { checkPiApiKey, KEY_CHECK_URLS } = await import('../../shared/runtime/provider-key-check.js');
const { checkConfiguredKey, keyRefusal } = await import('../src/commands/providers-key-check.js');
const { runNonInteractiveSetup } = await import('../wizard/setup-noninteractive.js');

const KEY = 'finta'; // short and plain on purpose: a secret scanner has nothing to flag
const answer = (status) => async () => ({ status, ok: status >= 200 && status < 300 });

test('401 is a refusal; 200 is valid; everything else is «could not verify», never a refusal', async () => {
  assert.equal((await checkPiApiKey('glm', KEY, { fetchImpl: answer(401) })).state, 'rejected');
  assert.equal((await checkPiApiKey('kimi', KEY, { fetchImpl: answer(200) })).state, 'valid');
  for (const status of [403, 404, 429, 500, 503]) {
    const verdict = await checkPiApiKey('glm', KEY, { fetchImpl: answer(status) });
    assert.equal(verdict.state, 'unverified', `HTTP ${status}`);
    assert.equal(verdict.reason, `HTTP ${status}`);
  }
  const offline = await checkPiApiKey('kimi', KEY, { fetchImpl: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } });
  assert.deepEqual([offline.state, offline.reason], ['unverified', 'ENOTFOUND']);
  const slow = await checkPiApiKey('kimi', KEY, { fetchImpl: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); } });
  assert.deepEqual([slow.state, slow.reason], ['unverified', 'timeout']);
});

test('the call is a GET with the key as a bearer, to the route of that provider (moonshot is kimi); no key, no call', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([url, init.method, init.headers.Authorization]); return { status: 200, ok: true }; };
  await checkPiApiKey('glm', ` ${KEY}\n`, { fetchImpl });
  await checkPiApiKey('moonshot', KEY, { fetchImpl });
  assert.deepEqual(seen, [[KEY_CHECK_URLS.glm, 'GET', `Bearer ${KEY}`], [KEY_CHECK_URLS.kimi, 'GET', `Bearer ${KEY}`]]);
  const none = await checkPiApiKey('glm', '  ', { fetchImpl: () => assert.fail('no call without a key') });
  assert.equal(none.state, 'unverified');
  assert.equal((await checkPiApiKey('openai', KEY, { fetchImpl: () => assert.fail('not this provider') })).state, 'not_applicable');
});

test('the key is never in the verdict or in the sentence of the refusal', async () => {
  for (const status of [401, 200, 500]) {
    assert.ok(!JSON.stringify(await checkPiApiKey('glm', KEY, { fetchImpl: answer(status) })).includes(KEY));
  }
  const config = { active_provider: 'glm', harness: 'pi', providers: { glm: { auth_method: 'api_key', api_key_ref: { type: 'ref', source: 'file', path: join(HOME, 'glm.key') } } } };
  writeFileSync(join(HOME, 'glm.key'), `${KEY}\n`);
  const sentence = await keyRefusal(config, { fetchImpl: answer(401) });
  assert.match(sentence, /^GLM \(Z\.ai\) rejected the API key \(HTTP 401.*jht setup$/);
  assert.ok(!sentence.includes(KEY));
});

test('a start is refused only for a refused key: not for a network that does not answer, not for another provider or harness', async () => {
  const withKey = (extra = {}) => ({ active_provider: 'kimi', harness: 'pi', providers: { kimi: { auth_method: 'api_key', api_key: KEY } }, ...extra });
  assert.match(await keyRefusal(withKey(), { fetchImpl: answer(401) }), /Kimi \(Moonshot\) rejected the API key/);
  assert.equal(await keyRefusal(withKey(), { fetchImpl: answer(200) }), null);
  assert.equal(await keyRefusal(withKey(), { fetchImpl: answer(503) }), null);
  assert.equal(await keyRefusal(withKey(), { fetchImpl: async () => { throw new Error('offline'); } }), null);
  // not on pi, or not with a key: nothing to ask
  assert.equal((await checkConfiguredKey(withKey({ harness: 'codex' }), { fetchImpl: () => assert.fail('codex harness') })).state, 'not_applicable');
  assert.equal((await checkConfiguredKey({ active_provider: 'openai', harness: 'pi', providers: { openai: { auth_method: 'api_key', api_key: KEY } } }, { fetchImpl: () => assert.fail('openai') })).state, 'not_applicable');
  assert.equal((await checkConfiguredKey({ active_provider: 'glm', harness: 'pi', providers: { glm: { auth_method: 'subscription' } } }, { fetchImpl: () => assert.fail('subscription') })).state, 'not_applicable');
});

async function setup(opts, status) {
  const out = [];
  const log = console.log; const error = console.error; const realFetch = globalThis.fetch;
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  globalThis.fetch = status === 'offline' ? async () => { throw new Error('offline'); } : answer(status);
  process.exitCode = 0;
  try { await runNonInteractiveSetup({ language: 'en', authMethod: 'api_key', harness: 'pi', secretMode: 'file', secretFile: join(HOME, 'setup.key'), ...opts }); }
  finally { console.log = log; console.error = error; globalThis.fetch = realFetch; }
  const code = process.exitCode; process.exitCode = 0;
  return { code, text: out.join('\n') };
}
const saved = () => existsSync(join(HOME, 'jht.config.json')) ? JSON.parse(readFileSync(join(HOME, 'jht.config.json'), 'utf8')) : null;

test('setup with a key the provider refuses: exit 1, a clear sentence, nothing saved, the key nowhere', async () => {
  writeFileSync(join(HOME, 'setup.key'), `${KEY}\n`);
  for (const provider of ['glm', 'kimi']) {
    const { code, text } = await setup({ provider }, 401);
    assert.equal(code, 1, text);
    assert.match(text, /rejected the API key \(HTTP 401/);
    assert.match(text, /Nothing was saved/);
    assert.ok(!text.includes(KEY));
    assert.equal(saved(), null, 'no config written for a refused key');
  }
});

test('setup with a key the provider accepts, or that could not be tried: saved (the second says so); --skip-health asks nothing', async () => {
  writeFileSync(join(HOME, 'setup.key'), `${KEY}\n`);
  const ok = await setup({ provider: 'glm' }, 200);
  assert.equal(ok.code, 0, ok.text);
  assert.match(ok.text, /the API key is accepted/);
  assert.equal(saved().active_provider, 'glm');

  const offline = await setup({ provider: 'kimi' }, 'offline');
  assert.equal(offline.code, 0, offline.text);
  assert.match(offline.text, /Could not check the API key with Kimi \(Moonshot\)/);
  assert.equal(saved().active_provider, 'kimi');

  const skipped = await setup({ provider: 'glm', skipHealth: true }, 401);
  assert.equal(skipped.code, 0, skipped.text);
  assert.equal(saved().active_provider, 'glm');
});
