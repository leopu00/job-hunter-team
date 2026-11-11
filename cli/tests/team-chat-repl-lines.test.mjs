// `jht team chat`: every line the person types reaches the agent, whenever it is typed (B1 of the Linux CLI ritest of
// c7baf5a3c, 02/11: two lines 47 ms apart, and a third 3 s later while the Assistant worked, were never delivered —
// the chat said «no reply yet» and nothing else). The REPL is run for real, on a pipe, against a fake tmux and a fake
// transport that records what it is given.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHAT = resolve(import.meta.dirname, '../src/commands/team/chat.js');

function fixture({ workSeconds = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-chat-repl-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(bin);
  mkdirSync(join(home, 'agents', 'assistente'), { recursive: true });
  const sent = join(root, 'sent.log');
  const chat = join(home, 'agents', 'assistente', 'chat.jsonl');
  const busy = join(root, 'busy-until');
  writeFileSync(chat, '');
  writeFileSync(join(bin, 'tmux'), [
    '#!/bin/sh',
    'case "$1" in',
    '  list-sessions) echo JHT-ASSISTENTE ;;',
    `  capture-pane) if [ -f '${busy}' ] && [ "$(cat '${busy}')" -gt "$(date +%s)" ]; then printf "%s\\n" "◦ Working (16s • esc to interrupt)" "" "› Run /review on my current changes"; else printf "%s\\n" "› Run /review on my current changes"; fi ;;`,
    'esac',
    'exit 0',
  ].join('\n'));
  // The transport: records the text; the agent is then at work for `workSeconds` (its pane shows the status line) and
  // answers in its chat file when it is done.
  writeFileSync(join(bin, 'jht-tmux-send'), [
    '#!/bin/sh',
    `printf "%s\\n" "$2" >> '${sent}'`,
    `echo $(( $(date +%s) + ${workSeconds} )) > '${busy}'`,
    `( sleep ${workSeconds}; printf '{"role":"assistant","text":"ok: %s","ts":"%s"}\\n' "$2" "$(date +%s)" >> '${chat}' ) >/dev/null 2>&1 &`,
    'exit 0',
  ].join('\n'));
  chmodSync(join(bin, 'tmux'), 0o755);
  chmodSync(join(bin, 'jht-tmux-send'), 0o755);
  return { root, bin, home, sent };
}

/** Runs the chat REPL; `script` is [delayMs, text] pairs written to its stdin. Resolves with what it printed and sent. */
function runChat(script, work, chatOptions = '{}') {
  const { bin, home, sent } = fixture(work);
  const code = `import { chatAction } from '${CHAT}'; await chatAction('assistente', ${chatOptions});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, JHT_HOME: home, NO_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((done) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 50_000);
    child.on('close', () => {
      clearTimeout(timer);
      done({ out, sent: existsSync(sent) ? readFileSync(sent, 'utf8').split('\n').filter(Boolean) : [] });
    });
    let at = 0;
    for (const [delay, text] of script) {
      at += delay;
      setTimeout(() => child.stdin.write(`${text}\n`), at);
    }
  });
}

test('two lines 47 ms apart and a third 3 s later are all delivered, in order', async () => {
  const r = await runChat([[300, 'one'], [47, 'two'], [3000, 'three'], [12_000, '/exit']]);
  assert.deepEqual(r.sent, ['one', 'two', 'three'], r.out);
});

test('lines typed while the agent is at work wait for it and are delivered, with a word to the person', async () => {
  const r = await runChat([[300, 'one'], [47, 'two'], [3000, 'three'], [20_000, '/exit']], { workSeconds: 6 });
  assert.deepEqual(r.sent, ['one', 'two', 'three'], r.out);
  assert.match(r.out, /still answering/, 'the person is told their line is waiting');
});

// A blocked agent (giro Mac 2 of 8e41de34f, 11/11): the chat says why and where to fix it instead of «no reply yet».
const blockedOptions = `{ blockedNotice: {
  provider: { name: 'glm', label: 'GLM (Z.ai)', apiKey: true }, width: 200,
  read: () => ({ agents: [{ id: 'assistente', session: 'ASSISTENTE', running: true, state: 'bloccato', reason: 'accesso_scaduto' }] }),
} }`;
const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ');

test('a blocked agent: the chat says why, the command, and jht agents; never a bare «no reply yet»', async () => {
  const r = await runChat([[300, 'hello'], [500, '/read'], [500, '/exit']], {}, blockedOptions);
  const out = plain(r.out);
  assert.match(out, /assistente is blocked: GLM \(Z\.ai\) rejected the API key/, r.out);
  assert.match(out, /jht setup --non-interactive --provider glm --harness pi --api-key-file <file>/);
  assert.match(out, /Nobody will answer until that is fixed\. What every agent is doing: jht agents\./);
  assert.doesNotMatch(out, /no reply yet|no new messages/);
}, { timeout: 60_000 });

test('an agent that is not blocked keeps the old words', async () => {
  const notBlocked = `{ blockedNotice: { read: () => ({ agents: [{ id: 'assistente', session: 'JHT-ASSISTENTE', running: true, state: 'attivo', reason: null }] }) } }`;
  const r = await runChat([[300, '/read'], [300, '/exit']], {}, notBlocked);
  assert.match(r.out, /no new messages/);
  assert.doesNotMatch(r.out, /is blocked/);
}, { timeout: 60_000 });
