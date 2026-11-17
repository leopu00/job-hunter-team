// `jht setup --non-interactive --provider glm|kimi --harness pi` (JHT-T314): the key from a file, never in the config;
// the providers that charge by the token run only on the pi harness, with an API key.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RELEASE_PROVIDERS, offeredInRelease } from '../../shared/runtime/release-providers.js';
const kimiSkip = offeredInRelease('kimi') ? false : 'kimi is not offered in this release (shared/runtime/release-providers.js)';

const HOME = mkdtempSync(join(tmpdir(), 'jht-pi-api-'));
process.env.JHT_HOME = HOME;
const { runNonInteractiveSetup } = await import('../wizard/setup-noninteractive.js');
const { findProviderChoice, PI_API_CHOICES } = await import('../wizard/setup-helpers.js');

async function setup(opts) {
  const out = [];
  const log = console.log; const error = console.error;
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  process.exitCode = 0;
  try { await runNonInteractiveSetup({ language: 'en', skipHealth: true, authMethod: 'api_key', ...opts }); }
  finally { console.log = log; console.error = error; }
  const code = process.exitCode; process.exitCode = 0;
  return { code, text: out.join('\n') };
}
const config = () => JSON.parse(readFileSync(join(HOME, 'jht.config.json'), 'utf8'));

test('the choices: glm and kimi with their pi variables, moonshot is kimi', () => {
  assert.deepEqual(PI_API_CHOICES.map((p) => [p.value, p.keyVariable]), [['glm', 'ZAI_API_KEY'], ['kimi', 'MOONSHOT_API_KEY'], ['claude', 'ANTHROPIC_API_KEY']]);
  assert.equal(findProviderChoice('anthropic').value, 'claude');
  assert.equal(findProviderChoice('moonshot').value, 'kimi');
  assert.equal(findProviderChoice('openai').value, 'openai');
  assert.equal(findProviderChoice('gemini'), undefined);
});

for (const [provider, model] of [['glm', 'glm-5.3'], ['kimi', 'kimi-k3.1-pro'], ['claude', 'claude-opus-5-5']]) {
  test(`${provider} with pi: the key is a reference to a file, the config says the harness and the model`, { skip: offeredInRelease(provider) ? false : `${provider} is not offered in this release` }, async () => {
    const { code, text } = await setup({ provider, harness: 'pi', secretMode: 'file', secretFile: '/dev/shm/jht-key' });
    assert.equal(code, 0, text);
    const saved = config();
    assert.equal(saved.active_provider, provider);
    assert.equal(saved.harness, 'pi');
    assert.equal(saved.providers[provider].model, model);
    assert.deepEqual(saved.providers[provider].api_key_ref, { type: 'ref', source: 'file', path: '/dev/shm/jht-key' });
    assert.equal(saved.providers[provider].api_key, undefined);
  });
}

test('the key variable of an env reference is the provider\'s, not a guess', { skip: kimiSkip }, async () => {
  const { code } = await setup({ provider: 'glm', harness: 'pi', secretMode: 'env' });
  assert.equal(code, 0);
  assert.equal(config().providers.glm.api_key_ref.id, 'ZAI_API_KEY');
  const moonshot = await setup({ provider: 'moonshot', harness: 'pi', secretMode: 'env' });
  assert.equal(moonshot.code, 0);
  assert.equal(config().active_provider, 'kimi');
  assert.equal(config().providers.kimi.api_key_ref.id, 'MOONSHOT_API_KEY');
});

test('their key is never plaintext: by reference only (a file the setup keeps, env or file); the file of the person is in setup-key-store.test.mjs', async () => {
  for (const extra of [{}, { secretMode: 'plaintext', apiKey: 'synthetic-key' }]) {
    const { code, text } = await setup({ provider: 'glm', harness: 'pi', ...extra });
    assert.equal(code, 1, text);
    assert.match(text, /by reference: use --api-key-file or --api-key-stdin .* or --secret-mode env or --secret-mode file/);
  }
});

test('they run only on pi, and only with an API key', async () => {
  const codex = await setup({ provider: 'glm', harness: 'codex', secretMode: 'file', secretFile: '/dev/shm/k' });
  assert.equal(codex.code, 1);
  assert.match(codex.text, /only on pi/);
  const subscription = await setup({ provider: 'glm', harness: 'pi', authMethod: 'subscription', subscriptionEmail: 'user@example.test' });
  assert.equal(subscription.code, 1);
  assert.match(subscription.text, /only with an API key/);
});

test('an unknown provider, and one this release does not offer, say what is offered', async () => {
  for (const provider of ['gemini', 'openai', 'claude', 'kimi', 'moonshot'].filter((name) => !offeredInRelease(name))) {
    const { code, text } = await setup({ provider });
    assert.equal(code, 1, provider);
    assert.match(text, new RegExp(`This release offers only ${RELEASE_PROVIDERS.join(', ')} with an API key, on the pi harness`), provider);
    assert.match(text, /jht setup --non-interactive --provider glm --api-key-stdin/, provider);
  }
});

test('without --provider and --harness the setup is GLM on pi', async () => {
  const { code, text } = await setup({ secretMode: 'file', secretFile: '/dev/shm/jht-key' });
  assert.equal(code, 0, text);
  assert.equal(config().active_provider, 'glm');
  assert.equal(config().harness, 'pi');
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));

// OpenAI with an API key, on pi (0.4.0): not pi-only (Codex is its other harness), the key by reference as for glm and kimi.
test('openai on pi with a key: pi is the default harness, the key by reference in OPENAI_API_KEY, the Codex model table', async () => {
  const { code, text } = await setup({ provider: 'openai', secretMode: 'env' });
  assert.equal(code, 0, text);
  const saved = config();
  assert.equal(saved.active_provider, 'openai');
  assert.equal(saved.harness, 'pi');
  assert.equal(saved.providers.openai.auth_method, 'api_key');
  assert.deepEqual(saved.providers.openai.api_key_ref, { type: 'ref', source: 'env', id: 'OPENAI_API_KEY' });
  assert.equal(saved.providers.openai.model, 'gpt-5.6-sol');
  // never plaintext, as for the providers that run only on pi
  const plain = await setup({ provider: 'openai', secretMode: 'plaintext', apiKey: ['sk', 'synthetic', 'x'].join('-').padEnd(24, '0') });
  assert.equal(plain.code, 1, plain.text);
  assert.match(plain.text, /OpenAI takes its key by reference/);
});

test('openai: Codex is not a way of this release, and is refused with the way that is', async () => {
  const codex = await setup({ provider: 'openai', harness: 'codex', secretMode: 'env' });
  assert.equal(codex.code, 1, codex.text);
  assert.match(codex.text, /This release runs OpenAI only on pi: drop --harness or use --harness pi/);
  const codexSubscription = await setup({ provider: 'openai', harness: 'codex', authMethod: 'subscription', subscriptionEmail: 'user@example.test' });
  assert.equal(codexSubscription.code, 1, codexSubscription.text);
});

test('openai on pi with the ChatGPT subscription: a way of this release, no key, no email, the sign-in is Pi\'s own (made by jht setup afterwards)', async () => {
  const { code, text } = await setup({ provider: 'openai', harness: 'pi', authMethod: 'subscription' });
  assert.equal(code, 0, text);
  assert.match(text, /ChatGPT subscription \(the sign-in is Pi's own/);
  assert.match(text, /jht providers update pi/);
  const saved = config();
  assert.equal(saved.active_provider, 'openai');
  assert.equal(saved.harness, 'pi');
  assert.equal(saved.providers.openai.auth_method, 'subscription');
  assert.equal(saved.providers.openai.api_key_ref, undefined);
  assert.equal(saved.providers.openai.api_key, undefined);
  assert.equal(saved.providers.openai.subscription, undefined, 'no email in the config');
  assert.equal(saved.providers.openai.model, 'gpt-5.6-sol');
});

test('the other services never take a subscription on pi: glm, kimi and claude are refused with the way that is', async () => {
  for (const provider of ['glm', 'kimi', 'claude']) {
    const { code, text } = await setup({ provider, authMethod: 'subscription', subscriptionEmail: 'user@example.test' });
    assert.equal(code, 1, `${provider}: ${text}`);
    assert.match(text, /only with an API key/, provider);
  }
});

test('claude on pi: anthropic is claude, the key by reference in ANTHROPIC_API_KEY, never with a subscription or on codex', async () => {
  const { code, text } = await setup({ provider: 'anthropic', secretMode: 'env' });
  assert.equal(code, 0, text);
  assert.equal(config().active_provider, 'claude');
  assert.equal(config().harness, 'pi');
  assert.equal(config().providers.claude.api_key_ref.id, 'ANTHROPIC_API_KEY');
  const subscription = await setup({ provider: 'claude', harness: 'pi', authMethod: 'subscription', subscriptionEmail: 'user@example.test' });
  assert.equal(subscription.code, 1, subscription.text);
  const codex = await setup({ provider: 'claude', harness: 'codex', secretMode: 'env' });
  assert.equal(codex.code, 1, codex.text);
  assert.match(codex.text, /only on pi/);
});
