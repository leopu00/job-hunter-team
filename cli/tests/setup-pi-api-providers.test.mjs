// `jht setup --non-interactive --provider glm|kimi --harness pi` (JHT-T314): the key from a file, never in the config;
// the providers that charge by the token run only on the pi harness, with an API key.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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
  assert.deepEqual(PI_API_CHOICES.map((p) => [p.value, p.keyVariable]), [['glm', 'ZAI_API_KEY'], ['kimi', 'MOONSHOT_API_KEY']]);
  assert.equal(findProviderChoice('moonshot').value, 'kimi');
  assert.equal(findProviderChoice('openai').value, 'openai');
  assert.equal(findProviderChoice('gemini'), undefined);
});

for (const [provider, model] of [['glm', 'glm-5.3'], ['kimi', 'kimi-k3.1-pro']]) {
  test(`${provider} with pi: the key is a reference to a file, the config says the harness and the model`, async () => {
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

test('the key variable of an env reference is the provider\'s, not a guess', async () => {
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
    const { code, text } = await setup({ provider: 'kimi', harness: 'pi', ...extra });
    assert.equal(code, 1, text);
    assert.match(text, /by reference: use --api-key-file or --api-key-stdin .* or --secret-mode env or --secret-mode file/);
  }
});

test('they run only on pi, and only with an API key', async () => {
  const codex = await setup({ provider: 'glm', secretMode: 'file', secretFile: '/dev/shm/k' });
  assert.equal(codex.code, 1);
  assert.match(codex.text, /only on the pi harness/);
  const subscription = await setup({ provider: 'kimi', harness: 'pi', authMethod: 'subscription', subscriptionEmail: 'user@example.test' });
  assert.equal(subscription.code, 1);
  assert.match(subscription.text, /only with an API key/);
});

test('an unknown provider says what is offered', async () => {
  const { code, text } = await setup({ provider: 'gemini', harness: 'pi' });
  assert.equal(code, 1);
  assert.match(text, /openai \(Codex\), glm \(Z\.ai\) or kimi \(Moonshot\)/);
});

test.after(() => rmSync(HOME, { recursive: true, force: true }));
