// The models by role that `jht setup` prints at the end, for a team on pi with an API key: the models the launcher really gives each
// role (Claude: the Capitano on Sonnet, Scout/Analista/Sentinella on Haiku), not the aliases of the old Claude Code table.
import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRoleModels } from '../wizard/setup-models.js';

const config = (provider, extra = {}) => ({ active_provider: provider, harness: 'pi', providers: { [provider]: { name: provider, auth_method: 'api_key' } }, ...extra });
const rows = (text) => Object.fromEntries(text.split('\n').slice(1).map((l) => l.trim().match(/^(\w+): (\S+) \((\w+)\)$/).slice(1, 3)));

test('Claude on pi: Sonnet for the Capitano, Haiku for Scout, Analista and Sentinella, Opus only where the writing counts', () => {
  const m = rows(summarizeRoleModels(config('claude')));
  assert.deepEqual([m.capitano, m.scout, m.analista, m.sentinella, m.assistente, m.scorer], ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-haiku-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual([m.scrittore, m.critico], ['claude-opus-5-5', 'claude-opus-5-5']);
});

test('GLM and Kimi on pi name the provider models; a pin in the config wins', () => {
  assert.equal(rows(summarizeRoleModels(config('glm'))).scout, 'glm-5.3-flash');
  assert.equal(rows(summarizeRoleModels(config('kimi'))).capitano, 'kimi-k3.1-pro');
  const pinned = config('claude', { team: { role_models: { capitano: { model: 'sol' } } } });
  assert.equal(rows(summarizeRoleModels(pinned)).capitano, 'claude-opus-5-5');
});
