// JHT-T346: the switch of the tools (core image -> full image) restarts the container under the person's chat. The chat says it on a
// line of its own and keeps the line being typed, `jht team status` says the team is moving onto the full tools instead of «no
// agent», and the chat that comes back puts the line back on the prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.JHT_HOME = mkdtempSync(join(tmpdir(), 'jht-tools-switch-chat-'));
process.env.JHT_LANG = 'en';
const { toolsSwitch, SWITCH_WINDOW_S } = await import('../src/lib/tools-switch.js');
const { createRestartWatch, keepDraft, takeDraft } = await import('../src/commands/team/chat.js');
const { handleAgents } = await import('../src/commands/agents.js');

const NOW = Date.parse('2026-11-27T22:46:30Z') / 1000;
function home(notice) {
  const root = mkdtempSync(join(tmpdir(), 'jht-switch-'));
  mkdirSync(join(root, 'state'));
  if (notice !== undefined) writeFileSync(join(root, 'state', 'tools-switch.json'), typeof notice === 'string' ? notice : JSON.stringify(notice));
  return root;
}

test('the switch is under way for ten minutes after the notice of the host, and nothing else is one', () => {
  assert.deepEqual(toolsSwitch({ home: home({ schema: 1, at: '2026-11-27T22:46:20Z' }), now: NOW }), { at: NOW - 10 });
  assert.equal(toolsSwitch({ home: home({ schema: 1, at: '2026-11-27T22:30:00Z' }), now: NOW }), null, 'older than the window');
  assert.ok(SWITCH_WINDOW_S >= 300);
  assert.equal(toolsSwitch({ home: home({ schema: 1, at: '2026-11-28T22:46:20Z' }), now: NOW }), null, 'in the future');
  for (const bad of ['not json', { schema: 2, at: '2026-11-27T22:46:20Z' }, { schema: 1, at: 'now' }, { schema: 1, at: 1764283580 }]) {
    assert.equal(toolsSwitch({ home: home(bad), now: NOW }), null, JSON.stringify(bad));
  }
  assert.equal(toolsSwitch({ home: home(), now: NOW }), null);
  const linked = home();
  const target = join(linked, 'elsewhere.json');
  writeFileSync(target, JSON.stringify({ schema: 1, at: '2026-11-27T22:46:20Z' }));
  symlinkSync(target, join(linked, 'state', 'tools-switch.json'));
  assert.equal(toolsSwitch({ home: linked, now: NOW }), null, 'a link is not believed');
});

test('the chat keeps the line being typed and says the switch once, on a line of its own', () => {
  const kept = [];
  let said = 0;
  let typing = '';
  let moving = null;
  const watch = createRestartWatch({ agent: 'assistente', line: () => typing, say: () => { said += 1; }, keep: (a, t) => kept.push([a, t]), moving: () => moving });
  watch.tick();
  assert.deepEqual(kept, [], 'nothing typed, nothing kept');
  typing = 'vorrei aggiungere che parlo anche';
  watch.tick();
  watch.tick();
  assert.deepEqual(kept, [['assistente', 'vorrei aggiungere che parlo anche']], 'kept once, when it changes');
  moving = { at: NOW };
  watch.tick();
  watch.tick();
  assert.equal(said, 1, 'the switch is said once');
  watch.sent();
  assert.deepEqual(kept.at(-1), ['assistente', ''], 'a line sent leaves nothing');
});

test('a chat that opens while the switch is already under way does not say it again', () => {
  let said = 0;
  const watch = createRestartWatch({ agent: 'assistente', line: () => '', say: () => { said += 1; }, keep: () => {}, moving: () => ({ at: NOW }) });
  watch.tick();
  assert.equal(said, 0);
});

test('the line kept goes back once, and only a line the person could have typed', () => {
  const root = home();
  keepDraft('assistente', 'parlo inglese e spagnolo', { home: root, now: () => NOW });
  assert.equal(takeDraft('assistente', { home: root, now: () => NOW + 120 }), 'parlo inglese e spagnolo');
  assert.equal(takeDraft('assistente', { home: root, now: () => NOW + 121 }), null, 'read once');
  keepDraft('assistente', 'vecchio', { home: root, now: () => NOW });
  assert.equal(takeDraft('assistente', { home: root, now: () => NOW + 3600 }), null, 'too old');
  keepDraft('assistente', 'testo\u001b]0;titolo\u0007', { home: root, now: () => NOW });
  assert.equal(takeDraft('assistente', { home: root, now: () => NOW }), null, 'a text a terminal would obey');
  keepDraft('assistente', 'x'.repeat(1001), { home: root, now: () => NOW });
  assert.equal(takeDraft('assistente', { home: root, now: () => NOW }), null, 'longer than a message');
  keepDraft('assistente', 'qualcosa', { home: root, now: () => NOW });
  keepDraft('assistente', '', { home: root, now: () => NOW });
  assert.equal(existsSync(join(root, 'state', 'chat-draft-assistente.json')), false, 'an empty line keeps nothing');
});

function status(snapshot, moving, json = false) {
  const lines = [];
  const log = console.log;
  const write = process.stdout.write;
  console.log = (line = '') => lines.push(String(line));
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    handleAgents({ json }, () => snapshot, { pauseOf: () => null, spendOf: () => null, whereOf: () => ({ host_type: 'local', host_os: 'linux' }), switchOf: () => moving });
  } finally {
    console.log = log;
    process.stdout.write = write;
  }
  return lines.join('\n');
}
const EMPTY = { ok: true, at: 0, running: 0, total: 0, usage: {}, sampling: {}, errors: [], agents: [] };

test('jht team status during the switch says the team is moving onto the full tools, never «no agent»', () => {
  const out = status(EMPTY, { at: NOW });
  assert.match(out, /^⏳ The team is moving onto the full tools of the Scouts/m);
  assert.doesNotMatch(out, /No agent/i);
  const after = status({ ...EMPTY, running: 2, total: 2 }, { at: NOW });
  assert.doesNotMatch(after, /moving onto the full tools/, 'the team back: the agents, not the switch');
  assert.doesNotMatch(status(EMPTY, null), /moving onto the full tools/);
  assert.deepEqual(JSON.parse(status(EMPTY, { at: NOW }, true)).tools_switch, { at: '2026-11-27T22:46:30.000Z' });
  assert.equal(JSON.parse(status(EMPTY, null, true)).tools_switch, null);
});
