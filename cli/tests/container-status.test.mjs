import assert from 'node:assert/strict';
import test from 'node:test';
import { statusAction } from '../src/commands/container.js';

function inspect({ status = 0, stdout = '', stderr = '', error = undefined } = {}) {
  const calls = [];
  return {
    calls,
    runner(command, args) {
      calls.push([command, args]);
      return { status, stdout, stderr, error };
    },
  };
}

function run(fake) {
  const lines = [];
  const exitCodes = [];
  const result = statusAction({
    inspectRunner: fake.runner,
    write: (line) => lines.push(line),
    setExitCode: (code) => exitCodes.push(code),
    now: () => Date.parse('2026-10-14T10:00:00Z'),
  });
  assert.deepEqual(fake.calls.map(([command, args]) => [command, args[0]]), [['docker', 'inspect']]);
  return { result, lines: lines.join('\n'), exitCodes };
}

test('status keeps engine failures unknown and never suggests or invokes up', () => {
  for (const failure of [
    { status: null, stderr: 'ENOENT' },
    { status: 2, stderr: 'daemon unavailable' },
    { status: 1, stderr: 'permission denied' },
    { status: 1, stderr: 'No such container: jht\nconnection interrupted' },
    { status: 1, stderr: 'No such container: jht', error: new Error('inspect failed') },
  ]) {
    const outcome = run(inspect(failure));
    assert.equal(outcome.result.kind, 'unknown');
    assert.deepEqual(outcome.exitCodes, [1]);
    assert.match(outcome.lines, /unknown/i);
    assert.doesNotMatch(outcome.lines, /\bup\b/i);
  }
});

test('status reports only trustworthy running or stopped inspect data', () => {
  const running = run(inspect({ stdout: 'running|example:image|2026-10-14T09:00:00Z|/data:/app' }));
  assert.equal(running.result.kind, 'running');
  assert.deepEqual(running.exitCodes, []);
  assert.match(running.lines, /running/);

  const stopped = run(inspect({ stdout: 'exited|example:image|0001-01-01T00:00:00Z|/data:/app' }));
  assert.equal(stopped.result.kind, 'stopped');
  assert.deepEqual(stopped.exitCodes, []);
  assert.match(stopped.lines, /stopped/);

  const malformed = run(inspect({ stdout: 'running|missing-fields' }));
  assert.equal(malformed.result.kind, 'unknown');
  assert.deepEqual(malformed.exitCodes, [1]);
});

test("status calls a container missing only for Docker's specific attestation", () => {
  const missing = run(inspect({ status: 1, stderr: 'Error response from daemon: No such container: jht\n' }));
  assert.equal(missing.result.kind, 'missing');
  assert.deepEqual(missing.exitCodes, []);
  assert.match(missing.lines, /missing/i);
  assert.doesNotMatch(missing.lines, /\bup\b/i);
});
