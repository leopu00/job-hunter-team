// `jht team chat`: the REPL shows what the agent wrote to its chat (its welcome included), not only the terminal.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chatAgentOf, createChatFeed, formatChatMessage, readChatPage } from '../src/commands/team/chat.js';

const welcome = { id: 'm1', role: 'agent', text: 'Ciao! Sono l’Assistente.', at: Date.UTC(2026, 9, 29, 11, 15, 40) / 1000 };

test('a session has the chat of its role', () => {
  assert.equal(chatAgentOf('ASSISTENTE'), 'assistente');
  assert.equal(chatAgentOf('JHT-CAPITANO'), 'capitano');
  assert.equal(chatAgentOf('SCOUT-1'), 'scout');
  assert.equal(chatAgentOf('CRITICO-S2'), 'critico');
  assert.equal(chatAgentOf('SENTINELLA'), null);
});

test('the chat is read through agent_chat.py: the agent, then the cursor when there is one', () => {
  const calls = [];
  const run = (args) => { calls.push(args); return { code: 0, stdout: `${JSON.stringify({ messages: [welcome], cursor: '120' })}\n`, stderr: '' }; };
  assert.deepEqual(readChatPage('assistente', null, { run }), { messages: [welcome], cursor: '120' });
  readChatPage('assistente', '120', { run });
  assert.deepEqual(calls, [['read', 'assistente'], ['read', 'assistente', '120']]);
});

test('a chat that cannot be read is null, not a crash and not an empty chat', () => {
  assert.equal(readChatPage('assistente', null, { run: () => ({ code: 2, stdout: '', stderr: 'no such file' }) }), null);
  assert.equal(readChatPage('assistente', null, { run: () => ({ code: 0, stdout: 'not json', stderr: '' }) }), null);
  assert.equal(readChatPage('assistente', null, { run: () => ({ code: 0, stdout: '{"messages":3,"cursor":"1"}', stderr: '' }) }), null);
  assert.equal(readChatPage('assistente', null, { run: () => { throw new Error('boom'); } }), null);
});

test('the welcome written to the chat is in the history the REPL opens with', () => {
  const read = () => ({ messages: [welcome], cursor: '120' });
  const feed = createChatFeed('assistente', read);
  const history = feed.history();
  assert.equal(history.length, 1);
  assert.match(formatChatMessage(history[0], 'assistente'), /Sono l’Assistente/);
  assert.deepEqual(feed.fresh(), [], 'what the history showed is not shown again');
});

test('only the rows that came since the last look are shown, once each', () => {
  const second = { id: 'm2', role: 'agent', text: 'Dimmi pure.', at: 0 };
  const pages = [{ messages: [welcome], cursor: '120' }, { messages: [second], cursor: '200' }, { messages: [second], cursor: '200' }, { messages: [], cursor: '200' }];
  const cursors = [];
  const feed = createChatFeed('assistente', (agent, cursor) => { cursors.push(cursor); return pages.shift(); });
  feed.history();
  assert.deepEqual(feed.fresh().map((m) => m.id), ['m2']);
  assert.deepEqual(feed.fresh(), []);
  assert.deepEqual(feed.fresh(), []);
  assert.deepEqual(cursors, [null, '120', '200', '200']);
});

test('an unreadable chat shows nothing and does not stop the REPL', () => {
  const feed = createChatFeed('assistente', () => null);
  assert.equal(feed.history(), null);
  assert.deepEqual(feed.fresh(), []);
});

test('what a terminal obeys never gets to the screen from an agent\'s words', () => {
  const text = formatChatMessage({ id: 'x', role: 'agent', text: 'ok\u001b[2Jfine\u0007\u202e', at: 0 }, 'assistente');
  assert.doesNotMatch(text, /[\u0001-\u0008\u000b-\u001a\u001c-\u001f\u007f-\u009f\u202e]/);
  assert.doesNotMatch(text, /\u001b/);
  assert.match(text, /ok\[2Jfine/);
});

test('who speaks is shown: the agent, the person, the system', () => {
  assert.match(formatChatMessage({ id: 'a', role: 'user', text: 'ciao', at: 0 }, 'assistente'), /^you/);
  assert.match(formatChatMessage({ id: 'b', role: 'system', text: 'x', at: 0 }, 'assistente'), /^system/);
  assert.match(formatChatMessage(welcome, 'assistente'), /^assistente \d\d:\d\d:\d\d/);
});

test('read for real: the welcome in the chat file of the Assistente comes through agent_chat.py on a host', () => {
  const home = mkdtempSync(join(tmpdir(), 'jht-chat-'));
  mkdirSync(join(home, 'agents', 'assistente'), { recursive: true });
  const row = { role: 'agent', text: 'Benvenuto! Sono l’Assistente.', ts: 1793186140, message_id: 'welcome-1' };
  writeFileSync(join(home, 'agents', 'assistente', 'chat.jsonl'), `${JSON.stringify(row)}\n`);
  const script = `
    import { createChatFeed } from '${resolve(import.meta.dirname, '../src/commands/team/chat.js')}';
    const feed = createChatFeed('assistente');
    process.stdout.write(JSON.stringify({ history: feed.history(), fresh: feed.fresh() }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: home, JHT_HOME: home, NO_COLOR: '1' },
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.history.length, 1, r.stderr);
  assert.equal(out.history[0].text, 'Benvenuto! Sono l’Assistente.');
  assert.deepEqual(out.fresh, []);
});
