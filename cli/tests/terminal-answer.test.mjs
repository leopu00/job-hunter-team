import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { answerTyped, describeAnswer } from '../src/lib/terminal-answer.js';

const ok = (result) => () => ({ ok: true, code: 0, stdout: `${JSON.stringify(result)}\n`, stderr: '' });

test('a line that answers the card is not sent on as text', () => {
  const asked = [];
  const found = answerTyped('ASSISTENTE', '1', {
    usingContainer: true,
    run: (agent, message) => { asked.push([agent, message]); return ok({ result: 'answered', questionId: 'aq:x', label: 'Confirm and save' })(); },
  });
  assert.deepEqual(found, { result: 'answered', label: 'Confirm and save' });
  assert.deepEqual(asked, [['assistente', '1']]);
  assert.equal(describeAnswer(found).failed, false);
  assert.match(describeAnswer(found).text, /Answer recorded: Confirm and save/);
});

test('chat, and every way the helper cannot say, is chat: the line is never lost', () => {
  const chat = { result: 'chat' };
  assert.deepEqual(answerTyped('CAPITANO', 'ciao', { usingContainer: true, run: ok({ result: 'chat' }) }), chat);
  for (const run of [
    () => { throw new Error('boom'); },
    () => ({ ok: false, code: -1, stdout: '', stderr: 'not running' }),
    () => ({ ok: true, code: 120, stdout: '{"error":"chat_invalid"}', stderr: '' }),
    () => ({ ok: true, code: 0, stdout: 'not json', stderr: '' }),
    () => ({ ok: true, code: 0, stdout: '', stderr: '' }),
    ok({ result: 'surprise' }),
  ]) {
    assert.deepEqual(answerTyped('ASSISTENTE', '1', { usingContainer: true, run }), chat);
  }
});

test('only the agents a person talks to, only with a container, only for a real line', () => {
  const never = () => { throw new Error('must not be asked'); };
  assert.deepEqual(answerTyped('SCOUT-1', '1', { usingContainer: true, run: never }), { result: 'chat' });
  assert.deepEqual(answerTyped('ASSISTENTE', '1', { usingContainer: false, run: never }), { result: 'chat' });
  assert.deepEqual(answerTyped('ASSISTENTE', '   ', { usingContainer: true, run: never }), { result: 'chat' });
  assert.deepEqual(answerTyped('', '1', { usingContainer: true, run: never }), { result: 'chat' });
});

test('a number that is not an option is told and the line is not sent', () => {
  const found = answerTyped('ASSISTENTE', 'Q1A2B 7', {
    usingContainer: true, run: ok({ result: 'invalid', reason: 'number_out_of_range', code: 'Q1A2B' }),
  });
  assert.equal(found.result, 'invalid');
  const said = describeAnswer(found);
  assert.equal(said.failed, true);
  assert.match(said.text, /not one of the options/);
  assert.equal(describeAnswer({ result: 'closed' }).failed, false);
});

test('team send and team chat ask before they send, and both stop on an answer', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../src/commands/team/chat.js'), 'utf8');
  assert.equal((source.match(/answerTyped\(session, /g) || []).length, 2);
  for (const call of source.split('answerTyped(session, ').slice(1)) {
    assert.ok(call.indexOf('sendMessage(session') > 0, 'the send follows the question');
    assert.ok(call.slice(0, call.indexOf('sendMessage(session')).includes("typed.result !== 'chat'"));
  }
});
