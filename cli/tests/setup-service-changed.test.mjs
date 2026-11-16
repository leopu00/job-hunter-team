// A setup that moves a saved team to another service or CLI has the running agents stopped before the team starts again.
import assert from 'node:assert/strict';
import test from 'node:test';

const { serviceChanged } = await import('../wizard/setup-helpers.js');
const { DEFAULT_HARNESS } = await import('../../shared/runtime/agent-harness.js');

test('only another service or another CLI than the saved one is a change', () => {
  const glm = { active_provider: 'glm', harness: 'pi', providers: { glm: {} } };
  assert.equal(serviceChanged(glm, 'claude', 'pi'), true);
  assert.equal(serviceChanged(glm, 'glm', 'codex'), true);
  assert.equal(serviceChanged(glm, 'glm', 'pi'), false);
  assert.equal(serviceChanged({ active_provider: 'moonshot', harness: 'pi' }, 'kimi', 'pi'), false, 'moonshot is kimi');
  assert.equal(serviceChanged({ active_provider: 'glm' }, 'glm', DEFAULT_HARNESS), false, 'no harness saved is the default one');
  for (const none of [undefined, null, {}, [], 'x', { active_provider: 3 }]) assert.equal(serviceChanged(none, 'glm', 'pi'), false);
});
