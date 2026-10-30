// `jht team chat`: the REPL shows every open card of the agent with its options numbered, whatever channel it was
// delivered by (Gate CLI Linux 19i, A6: the plan's card was in the database and the chat showed nothing).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatFeed, createChatPump, formatCard, readOpenCards } from '../src/commands/team/chat.js';

// eslint-disable-next-line no-control-regex
const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');
const welcome = { id: 'm1', role: 'agent', text: 'Hi, I am the Assistant.', at: 1 };
const plan = {
  id: 'Q-plan', code: 'Q1A2B', subject: 'Plan', text: 'Which subscription plan do you have?',
  options: ['Plus', 'Pro', 'Pro 20x', 'I do not know'], multiple: false,
};
const family = { id: 'Q-family', code: 'Q3C4D', subject: 'Roles', text: 'Which family of roles?', options: ['Engineering', 'Design'], multiple: false };

test('the open cards are read through agent_chat.py questions', () => {
  const calls = [];
  const run = (args) => { calls.push(args); return { code: 0, stdout: `${JSON.stringify({ questions: [plan] })}\n`, stderr: '' }; };
  assert.deepEqual(readOpenCards('assistente', { run }), [plan]);
  assert.deepEqual(calls, [['questions', 'assistente']]);
});

test('cards that cannot be read are null, and a malformed one is left out', () => {
  assert.equal(readOpenCards('assistente', { run: () => ({ code: 2, stdout: '', stderr: 'unknown' }) }), null);
  assert.equal(readOpenCards('assistente', { run: () => ({ code: 0, stdout: 'not json', stderr: '' }) }), null);
  assert.equal(readOpenCards('assistente', { run: () => { throw new Error('boom'); } }), null);
  const mixed = { code: 0, stdout: JSON.stringify({ questions: [plan, { id: 3 }, { id: 'x', options: [] }, null] }), stderr: '' };
  assert.deepEqual(readOpenCards('assistente', { run: () => mixed }), [plan]);
});

test('a card is shown with its code, its text and its options numbered from 1', () => {
  const text = plain(formatCard(plan));
  assert.match(text, /question\s+Q1A2B\s+Plan/);
  assert.match(text, /Which subscription plan do you have\?/);
  assert.match(text, /1\) Plus\n\s+2\) Pro\n\s+3\) Pro 20x\n\s+4\) I do not know/);
  assert.match(text, /Answer with the number/);
  assert.match(text, /«Q1A2B 1»/);
});

test('what a terminal obeys never reaches the screen from a card', () => {
  const text = formatCard({ ...plan, text: 'Plan?\u001b[2J\u0007', options: ['Plus\u001b]0;x\u0007', 'Pro'] });
  assert.doesNotMatch(plain(text), /[\u0000-\u0008\u000b-\u001f\u007f]/);
});

test('a card that takes several options says to answer it in the app', () => {
  assert.match(plain(formatCard({ ...plan, multiple: true })), /answer it in the app/);
});

test('the history opens with the welcome and then the cards that are open', () => {
  const feed = createChatFeed('assistente', () => ({ messages: [welcome], cursor: '10' }), () => [plan]);
  const rows = feed.history();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'm1');
  assert.deepEqual(rows[1], { card: plan });
});

test('a card is shown once, and a card that opens later comes with the next look', () => {
  let open = [plan];
  const feed = createChatFeed('assistente', () => ({ messages: [welcome], cursor: '10' }), () => open);
  feed.history();
  assert.deepEqual(feed.fresh(), [], 'the plan card was shown already');
  open = [plan, family];
  assert.deepEqual(feed.fresh(), [{ card: family }]);
  assert.deepEqual(feed.fresh(), []);
});

test('the cards come even when the chat file cannot be read', () => {
  const feed = createChatFeed('assistente', () => null, () => [plan]);
  assert.equal(feed.history(), null, 'the REPL still says the chat cannot be read');
  assert.deepEqual(feed.fresh(), [{ card: plan }]);
});

test('/cards lists every open card again, the ones shown before included', () => {
  const feed = createChatFeed('assistente', () => ({ messages: [], cursor: '1' }), () => [plan, family]);
  feed.history();
  assert.deepEqual(feed.open(), [{ card: plan }, { card: family }]);
  assert.deepEqual(createChatFeed('assistente', () => ({ messages: [], cursor: '1' }), () => null).open(), []);
});

test('a card that arrives ends the wait for the reply, and is not printed twice', async () => {
  let open = [];
  const feed = createChatFeed('assistente', () => ({ messages: [], cursor: '1' }), () => open);
  feed.history();
  const pump = createChatPump(feed);
  let looks = 0;
  const sleep = async () => { looks += 1; if (looks === 2) open = [plan]; };
  const rows = await pump.awaitReply({ sleep, timeoutMs: 60_000, everyMs: 1 });
  assert.deepEqual(rows, [{ card: plan }]);
  assert.deepEqual(pump.tick(), [], 'the poller does not show it again');
});

test('without a card reader the feed behaves as before', () => {
  const feed = createChatFeed('assistente', () => ({ messages: [welcome], cursor: '10' }));
  assert.equal(feed.history().length, 1);
  assert.deepEqual(feed.fresh(), []);
});
