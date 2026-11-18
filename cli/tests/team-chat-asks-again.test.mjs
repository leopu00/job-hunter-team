// `jht team chat`: the question that an update or a switch of the tools left without an answer (Windows retest of build 13: the
// container created again under the chat ended it, and the question asked a moment before was never answered). The REPL keeps the
// last text it sent until the agent writes something; the chat that the wrapper brings back (JHT_TEAM_CHAT_RESUMED=1) asks it again.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { forgetAsked, rememberAsked, unansweredQuestion } from '../src/commands/team/chat.js';

const CHAT = resolve(import.meta.dirname, '../src/commands/team/chat.js');
const NOW = () => Math.floor(Date.now() / 1000);
const homeDir = () => mkdtempSync(join(tmpdir(), 'jht-chat-asked-'));
const askedPath = (home) => join(home, 'state', 'chat-asked-assistente.json');

test('a question kept is the one asked again, until something the agent wrote comes after it', () => {
  const home = homeDir();
  assert.equal(unansweredQuestion('assistente', [], { home }), null, 'nothing kept, nothing to ask');
  rememberAsked('assistente', 'Any news?', { home, now: () => 1000 });
  assert.equal(unansweredQuestion('assistente', [], { home, now: () => 1100 }), 'Any news?');
  const own = [{ role: 'user', at: 1005, text: 'Any news?' }, { role: 'system', at: 1010, text: 'JHT is updating' }, { card: { id: 'q' } }];
  assert.equal(unansweredQuestion('assistente', own, { home, now: () => 1100 }), 'Any news?', 'the person, the system and a card are not an answer');
  const before = [{ role: 'assistant', at: 900, text: 'an older answer' }];
  assert.equal(unansweredQuestion('assistente', before, { home, now: () => 1100 }), 'Any news?', 'an answer from before the question is not its answer');
  const answered = [{ role: 'assistant', at: 1040, text: 'Yes, 3 new offers' }];
  assert.equal(unansweredQuestion('assistente', answered, { home, now: () => 1100 }), null);
});

test('a question kept for too long is not asked again, and forgetting it leaves nothing', () => {
  const home = homeDir();
  rememberAsked('assistente', 'Any news?', { home, now: () => 1000 });
  assert.equal(unansweredQuestion('assistente', [], { home, now: () => 1000 + 31 * 60 }), null);
  forgetAsked('assistente', { home });
  assert.equal(existsSync(askedPath(home)), false);
  assert.equal(unansweredQuestion('assistente', [], { home, now: () => 1001 }), null);
});

test('a file that an agent wrote is not a question the person asked: controls, an empty text or a long one discard it', () => {
  const home = homeDir();
  const write = (text) => {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(askedPath(home), JSON.stringify({ text, at: 1000 }));
    return unansweredQuestion('assistente', [], { home, now: () => 1100 });
  };
  assert.equal(write('Any news?'), 'Any news?');
  assert.equal(write('Any news?\u001b]0;pwned\u0007'), null, 'ESC and OSC for the terminal of the person');
  assert.equal(write('\u001b[2JAny news?'), null);
  assert.equal(write('Any\u202enews?'), null, 'a direction mark');
  assert.equal(write('Any\u0000news?'), null);
  assert.equal(write('   '), null);
  assert.equal(write('x'.repeat(1001)), null);
  assert.equal(write('x'.repeat(1000)), 'x'.repeat(1000));
  assert.equal(write(42), null);
});

test('a chat that comes back does not show or send a question with controls', async () => {
  const r = await runChat({ asked: { text: 'Any news?\u001b]0;pwned\u0007', at: NOW() - 60 } }, { resumed: true });
  assert.deepEqual(r.sent, [], r.out);
  assert.doesNotMatch(r.out, /pwned|\u001b\]0/);
}, { timeout: 60_000 });

test('a folder that cannot be written is no reason for the chat to fail', () => {
  const root = homeDir();
  writeFileSync(join(root, 'state'), 'a file where a folder should be');
  rememberAsked('assistente', 'Any news?', { home: root });
  forgetAsked('assistente', { home: root });
  assert.equal(unansweredQuestion('assistente', [], { home: root }), null);
});

// ── the REPL for real, on a pipe, against a fake tmux and a fake transport ──────────────────────────────────

function fixture({ asked = null, rows = [], answers = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-chat-again-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(bin);
  mkdirSync(join(home, 'agents', 'assistente'), { recursive: true });
  const sent = join(root, 'sent.log');
  const chat = join(home, 'agents', 'assistente', 'chat.jsonl');
  writeFileSync(chat, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  writeFileSync(join(bin, 'tmux'), ['#!/bin/sh', 'case "$1" in', '  list-sessions) echo JHT-ASSISTENTE ;;',
    '  capture-pane) printf "%s\\n" "› Run /review on my current changes" ;;', 'esac', 'exit 0'].join('\n'));
  writeFileSync(join(bin, 'jht-tmux-send'), ['#!/bin/sh', `printf "%s\\n" "$2" >> '${sent}'`,
    ...(answers ? [`printf '{"role":"assistant","text":"ok: %s","ts":"%s"}\\n' "$2" "$(date +%s)" >> '${chat}'`] : []), 'exit 0'].join('\n'));
  chmodSync(join(bin, 'tmux'), 0o755);
  chmodSync(join(bin, 'jht-tmux-send'), 0o755);
  if (asked) {
    mkdirSync(join(home, 'state'), { recursive: true });
    writeFileSync(askedPath(home), JSON.stringify(asked));
  }
  return { bin, home, sent };
}

function runChat(setup, { resumed = false, locale = null, script = [[1500, '/exit']] } = {}) {
  const { bin, home, sent } = fixture(setup);
  if (locale) writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale }));
  const code = `import { chatAction } from '${CHAT}'; await chatAction('assistente', {});`;
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, JHT_HOME: home, NO_COLOR: '1' };
  if (resumed) env.JHT_TEAM_CHAT_RESUMED = '1';
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((done) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 50_000);
    child.on('close', () => {
      clearTimeout(timer);
      done({ out: out.replace(/\x1b\[[0-9;]*m/g, ''), home, sent: existsSync(sent) ? readFileSync(sent, 'utf8').split('\n').filter(Boolean) : [] });
    });
    let at = 0;
    for (const [delay, text] of script) { at += delay; setTimeout(() => child.stdin.write(`${text}\n`), at); }
  });
}

const lost = () => ({ text: 'Any news?', at: NOW() - 60 });

test('a chat that comes back asks again the question nothing answered, and says so', async () => {
  const r = await runChat({ asked: lost() }, { resumed: true });
  assert.deepEqual(r.sent, ['Any news?'], r.out);
  assert.match(r.out, /The team was restarting and your last question got no answer\. Asking it again: «Any news\?»/);
  assert.match(r.out, /ok: Any news\?/, 'the answer is shown');
  assert.equal(existsSync(askedPath(r.home)), false, 'answered: nothing kept');
}, { timeout: 60_000 });

test('the words to the person are in their language', async () => {
  const r = await runChat({ asked: lost() }, { resumed: true, locale: 'it' });
  assert.match(r.out, /La squadra si stava riavviando e la tua ultima domanda non ha avuto risposta\. La ripeto: «Any news\?»/, r.out);
}, { timeout: 60_000 });

test('a chat opened by hand does not ask again what an earlier chat left', async () => {
  const r = await runChat({ asked: lost() }, { resumed: false });
  assert.deepEqual(r.sent, [], r.out);
}, { timeout: 60_000 });

test('a question that was answered is not asked again', async () => {
  const r = await runChat({ asked: lost(), rows: [{ role: 'assistant', text: 'Yes, 3 new offers', ts: String(NOW() - 20) }] }, { resumed: true });
  assert.deepEqual(r.sent, [], r.out);
}, { timeout: 60_000 });

test('a question typed in the chat is kept while nothing answers it and forgotten when the agent answers', async () => {
  const silent = await runChat({ answers: false }, { script: [[400, 'Hello there'], [500, '/exit']] });
  assert.deepEqual(silent.sent, ['Hello there'], silent.out);
  assert.equal(JSON.parse(readFileSync(askedPath(silent.home), 'utf8')).text, 'Hello there');
  const answered = await runChat({}, { script: [[400, 'Hello there'], [6000, '/exit']] });
  assert.equal(existsSync(askedPath(answered.home)), false, answered.out);
}, { timeout: 120_000 });
