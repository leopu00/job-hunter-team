import assert from 'node:assert/strict';
import test from 'node:test';
import { cliAvailable, providerCli } from '../src/commands/team/agents.js';

test('the CLI that drives the agents is the active provider\'s, by name or alias', () => {
  assert.equal(providerCli({ active_provider: 'openai' }), 'codex');
  assert.equal(providerCli({ active_provider: 'Codex' }), 'codex');
  assert.equal(providerCli({ active_provider: ' claude ' }), 'claude');
  assert.equal(providerCli({ active_provider: 'anthropic' }), 'claude');
  assert.equal(providerCli({ active_provider: 'moonshot' }), 'kimi');
});

test('no provider chosen is no CLI: claude is never the answer by default', () => {
  for (const config of [null, undefined, {}, { active_provider: '' }, { active_provider: '  ' }, { active_provider: 7 }, { active_provider: 'unknown' }]) {
    assert.equal(providerCli(config), null, JSON.stringify(config));
  }
});

test('only a plain CLI name is looked up in the PATH', () => {
  assert.equal(cliAvailable('node; echo x'), false);
  assert.equal(cliAvailable('node'), true);
  assert.equal(cliAvailable('jht-no-such-cli'), false);
});
