// An agent that shows «blocked» says why, in a line a person can act on (giro 2 of the clean Windows run, 11/11):
// a key the provider refuses names the provider and the command that gives it the right one. Made-up snapshots and homes only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { activeProviderOf } from '../src/lib/agent-observation-provider.js';
import { blockedLines, renderObservation } from '../src/lib/agent-observation-view.js';

process.env.JHT_LANG = 'en';

function row(extra = {}) {
  return { id: 'assistente', session: 'ASSISTENTE', running: true, state: 'bloccato', reason: 'accesso_scaduto',
    identity: { model: 'glm-5.3', effort: 'high' }, usage: { tokens: null, reason: null }, process: null, ...extra };
}
function snapshot(...agents) {
  return { ok: true, at: 1, running: agents.length, total: agents.length, errors: [],
    usage: { window: '1h', unit: 'weighted_tokens', generated_at: '2026-01-01T00:00:00Z', age_seconds: 30 }, agents };
}
const glmOnPi = { active_provider: 'glm', harness: 'pi', providers: { glm: { auth_method: 'api_key' } } };
const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ');

test('a key the provider refuses: the provider, the reason and the command that puts it right', () => {
  const provider = activeProviderOf(glmOnPi);
  assert.deepEqual(provider, { name: 'glm', label: 'GLM (Z.ai)', apiKey: true });
  const text = strip(renderObservation(snapshot(row()), { usage: false, provider, width: 200 }));
  assert.match(text, / assistente is blocked: GLM \(Z\.ai\) rejected the API key \(wrong, expired or revoked\)\./);
  assert.match(text, /jht setup --non-interactive --provider glm --harness pi --api-key-file <file>/);
  assert.match(text, /--api-key-stdin/);
  assert.match(text, /jht team stop, jht team start/);
});

test('the same words on every system: nothing in the line depends on the host', () => {
  const text = strip(blockedLines(snapshot(row()), activeProviderOf(glmOnPi)).join('\n'));
  assert.doesNotMatch(text, /powershell|cmd\.exe|&&|\\/i);
});

test('a login that is refused (no key on this provider) says so and sends to the setup', () => {
  const provider = activeProviderOf({ active_provider: 'codex', providers: { codex: { auth_method: 'oauth' } } });
  assert.equal(provider.apiKey, false);
  const text = strip(blockedLines(snapshot(row()), provider).join('\n'));
  assert.match(text, /assistente is blocked: codex refused the login \(expired or revoked\)\./);
  assert.match(text, /Sign in again with: jht setup/);
  assert.doesNotMatch(text, /api-key/);
});

test('a provider that is not known still gets a sentence, not a bare «blocked»', () => {
  const text = strip(blockedLines(snapshot(row()), null).join('\n'));
  assert.match(text, /assistente is blocked: the provider refused the login/);
});

test('the other reasons: limit, network, error, and a reason nobody told', () => {
  const lines = (reason) => strip(blockedLines(snapshot(row({ reason })), null).join('\n'));
  assert.match(lines('limite_5h'), /usage limit of the provider was reached/);
  assert.match(lines('limite_fornitore'), /usage limit of the provider was reached/);
  assert.match(lines('rete'), /could not be reached \(network or proxy\)/);
  assert.match(lines('errore_fornitore'), /answered with an error/);
  assert.match(lines(null), /answered with an error/);
});

test('only a blocked agent that runs gets a line; a working or stopped one gets none', () => {
  const data = snapshot(row({ id: 'capitano', state: 'lavora', reason: null }), row({ id: 'scout-1', running: false, state: 'spento' }));
  assert.deepEqual(blockedLines(data, activeProviderOf(glmOnPi)), []);
});

test('what the row carries is printed as text only: control characters are dropped', () => {
  const text = blockedLines(snapshot(row({ id: 'assistente\x1b[31m' })), activeProviderOf(glmOnPi)).join('\n');
  assert.doesNotMatch(text, /\x1b\[31m/);
});

test('the provider of a configuration that says glm without a key or without pi is not a key provider', () => {
  assert.equal(activeProviderOf({ active_provider: 'glm', harness: 'pi', providers: { glm: { auth_method: 'oauth' } } }).apiKey, false);
  assert.equal(activeProviderOf({}), null);
  assert.equal(activeProviderOf(null), null);
});
