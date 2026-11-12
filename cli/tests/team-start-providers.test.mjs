// `jht team start` must start with every provider the setup offers (JHT-P0, glm): the tests of the setup and of the harness
// covered what is written, none started the team with it, and a provider added to the setup without its place in the table of
// the CLI of a provider was refused by team start as «no active provider».
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { providerCli } from '../src/commands/team/agents.js';
import { startRefusal } from '../src/commands/team/start.js';
import { AI_PROVIDERS, PI_API_CHOICES } from '../wizard/setup-helpers.js';
import { AGENT_HARNESSES, harnessProblem, piApiKeyConfigured } from '../../shared/runtime/agent-harness.js';
import { effectiveSettings } from '../src/lib/team-settings.js';
import { offeredInRelease } from '../../shared/runtime/release-providers.js';

// What the setup writes for a provider: the same shape as setup-noninteractive.js (a key by reference, no plaintext key).
const configOf = (provider, harness) => ({
  version: 1,
  active_provider: provider.value,
  providers: { [provider.value]: { name: provider.value, auth_method: 'api_key', api_key_ref: { type: 'ref', source: 'env', id: provider.keyVariable ?? 'OPENAI_API_KEY' } } },
  channels: {},
  harness,
});

// The pairs the setup lets through: a provider that runs only on pi is refused with another harness (setup-noninteractive.js).
const PAIRS = [...AI_PROVIDERS, ...PI_API_CHOICES].flatMap((provider) => AGENT_HARNESSES
  .filter((harness) => !(provider.piOnly && harness !== 'pi') && harnessProblem(harness, provider.value, 'api_key') === null)
  .map((harness) => ({ provider, harness })));
// what this release offers (shared/runtime/release-providers.js); the others are refused with the way out
const OFFERED = PAIRS.filter(({ provider }) => offeredInRelease(provider.value));
const NOT_OFFERED = PAIRS.filter(({ provider }) => !offeredInRelease(provider.value));

test('the code still knows codex and the two providers that run only on pi, each with the harness it allows', () => {
  const pairs = PAIRS.map(({ provider, harness }) => `${provider.value}/${harness}`);
  for (const wanted of ['openai/codex', 'openai/pi', 'glm/pi', 'kimi/pi']) assert.ok(pairs.includes(wanted), `${wanted} in ${pairs}`);
  assert.ok(!pairs.includes('glm/codex'));
  assert.ok(OFFERED.some(({ provider, harness }) => provider.value === 'glm' && harness === 'pi'));
});

for (const { provider, harness } of NOT_OFFERED) {
  test(`team start refuses a provider this release does not offer, with the setup as the way out: ${provider.value} on ${harness}`, () => {
    const refusal = startRefusal(configOf(provider, harness), { containerMode: false, hasTmux: () => true, hasCli: () => true });
    assert.match(refusal, new RegExp(`provider '${provider.value}' is not offered in this release .*Run: jht setup`));
    assert.doesNotMatch(refusal, /Install|github\.com/);
  });
}

for (const { provider, harness } of OFFERED) {
  test(`team start accepts what the setup writes: ${provider.value} on ${harness}`, () => {
    const config = configOf(provider, harness);
    assert.notEqual(providerCli(config), null, `no CLI for ${provider.value} on ${harness}`);
    if (harness === 'pi') assert.equal(providerCli(config), 'pi');
    assert.equal(startRefusal(config, { containerMode: true }), null);
    // outside the container the answer depends on tmux and on the CLI, never on «no active provider»
    const outside = startRefusal(config, { containerMode: false, hasTmux: () => true, hasCli: () => true });
    assert.equal(outside, null);
    assert.doesNotMatch(String(startRefusal(config, { containerMode: false, hasTmux: () => false, hasCli: () => false })), /no active provider/);
  });
}

test('glm on the pi harness is driven by pi, and with the other harness it is refused for what it is, not as «no provider»', () => {
  const glm = PI_API_CHOICES.find((p) => p.value === 'glm');
  assert.equal(providerCli(configOf(glm, 'pi')), 'pi');
  assert.equal(providerCli(configOf(glm, 'codex')), null);
  const refusal = startRefusal(configOf(glm, 'codex'), { containerMode: true });
  assert.match(refusal, /GLM \(Z\.ai\) runs only on the pi harness/);
  assert.match(refusal, /jht providers harness pi/);
  assert.doesNotMatch(refusal, /no active provider/);
  // a subscription is still refused on the provider that has none, by the harness rule
  const subscription = { ...configOf(glm, 'pi'), providers: { glm: { name: 'glm', auth_method: 'subscription' } } };
  assert.match(startRefusal(subscription, { containerMode: true }), /only with an API key/);
});

test('a provider the setup does not offer is still «no active provider»', () => {
  for (const active_provider of ['', 'gemini', 'zai', undefined]) {
    assert.match(startRefusal({ active_provider, harness: 'pi' }, { containerMode: true }), /no active provider/, String(active_provider));
  }
});

test('the roles that kimi and glm show in the team settings are not made up', () => {
  assert.equal(effectiveSettings({ active_provider: 'glm' }, {}).provider, 'glm');
  assert.equal(effectiveSettings({ active_provider: 'glm' }, {}).effective, null);
});

test('glm and kimi on pi count as signed in only with their key: a file that is there, another reference, or the key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jht-key-'));
  const key = join(dir, 'zai.key');
  writeFileSync(key, 'synthetic-key\n');
  const glm = (entry) => ({ active_provider: 'glm', harness: 'pi', providers: { glm: entry } });
  assert.equal(piApiKeyConfigured(glm({ api_key_ref: { type: 'ref', source: 'file', path: key } })), true);
  assert.equal(piApiKeyConfigured(glm({ api_key_ref: { type: 'ref', source: 'file', path: join(dir, 'missing') } })), false);
  assert.equal(piApiKeyConfigured(glm({ api_key_ref: { type: 'ref', source: 'env', id: 'ZAI_API_KEY' } })), true);
  assert.equal(piApiKeyConfigured(glm({ api_key: 'synthetic' })), true);
  assert.equal(piApiKeyConfigured(glm({})), false);
  assert.equal(piApiKeyConfigured({ ...glm({ api_key: 'x' }), harness: 'codex' }), false);
  assert.equal(piApiKeyConfigured({ active_provider: 'openai', harness: 'pi', providers: { openai: { api_key: 'x' } } }), false);
  assert.equal(piApiKeyConfigured({ ...glm({ api_key: 'x' }), active_provider: 'moonshot' }), false);
});
