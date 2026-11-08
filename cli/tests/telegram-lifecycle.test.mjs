import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeTelegram, telegramPlanArgs } from '../src/lib/telegram-lifecycle.js';

function transport(plan, result = { status: 0 }) {
  const calls = [];
  return { calls, run(command, args, options) {
    calls.push({ command, args, options });
    return calls.length === 1 ? plan : result;
  } };
}

for (const [operation, expected] of [['start', ['up', '-d']], ['stop', ['stop']]]) {
  test(`resume transports the runtime decision ${operation} without guessing configuration`, () => {
    const fake = transport({ status: 0, stdout: operation + '\n' });
    assert.equal(resumeTelegram({ run: fake.run, cwd: '/synthetic/runtime', env: { TEST: 'only' } }), true);
    assert.deepEqual(fake.calls[0].args, ['compose', ...telegramPlanArgs('prepare', 'resume')]);
    assert.deepEqual(fake.calls[1].args, ['compose', ...expected, 'jht-telegram']);
    assert.equal(fake.calls[0].options.cwd, '/synthetic/runtime');
    assert.deepEqual(fake.calls[1].options.env, { TEST: 'only', MSYS_NO_PATHCONV: '1' });
    assert.equal(fake.calls[0].args.includes('--no-deps'), true);
  });
}

test('an invalid or failed plan never mutates the service', () => {
  for (const plan of [
    { status: 1, stdout: 'start' }, { status: null, error: new Error('offline') },
    { status: 0 }, { status: 0, stdout: 'start\nstop' },
    { status: 0, stdout: 'other-service' }, { status: 0, stdout: '' },
  ]) {
    const fake = transport(plan);
    assert.equal(resumeTelegram({ run: fake.run }), false);
    assert.equal(fake.calls.length, 1);
  }
});

test('a failed engine operation remains a failed command', () => {
  for (const result of [{ status: 3 }, { status: null, error: new Error('timeout') }]) {
    const fake = transport({ status: 0, stdout: 'start' }, result);
    assert.equal(resumeTelegram({ run: fake.run }), false);
    assert.equal(fake.calls.length, 2);
  }
});
