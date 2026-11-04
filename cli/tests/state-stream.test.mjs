import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CACHE_MAX_BYTES, CACHE_MAX_ENTRIES, CHAT_AGENTS, EXIT_PROTOCOL, MAX_LINE, PROFILE_SCRIPT, READERS, TEAM_START_SCRIPT, WORK_STATS_SCRIPT, containerId, createStateStream, depthOf, opsOf, readerEnv, runReader,
} from '../src/lib/state-stream.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE = readFileSync(join(ROOT, 'cli/src/lib/state-stream.js'), 'utf8');

// ── the harness: a stream with a fake reader and a fake clock ────────────────────────────────
function harness({ reply = { exit: 0, out: '{"ok":true}\n' }, shas = { 'profile.progress': 'a'.repeat(64), 'team.start': 'c'.repeat(64), 'work.stats': 'd'.repeat(64) }, stat, cid = () => 'b'.repeat(64) } = {}) {
  const lines = [];
  const ended = [];
  const calls = [];
  const killers = [];
  let clock = 1_000_000;
  let release = null;
  const run = (argv, options = {}) => {
    calls.push({ argv, options });
    if (options.track) killers.push(options.track);
    if (typeof reply === 'function') return reply(argv, options);
    return Promise.resolve(reply);
  };
  const stream = createStateStream({
    write: (line) => lines.push(JSON.parse(line)),
    end: (code) => ended.push(code),
    run,
    now: () => clock,
    stat,
    cid,
    scriptSha: (op) => shas[op] ?? null,
    home: '/jht_home',
    setTimer: (fn) => { release = fn; return 1; },
    clearTimer: () => {},
  });
  stream.hello();
  return {
    stream, lines, ended, calls, killers,
    tick: (ms) => { clock += ms; },
    idle: () => release?.(),
    send: (object) => stream.push(`${typeof object === 'string' ? object : JSON.stringify(object)}\n`),
    next: async () => { await new Promise((resolve) => setImmediate(resolve)); return lines[lines.length - 1]; },
  };
}

// ── the hello ─────────────────────────────────────────────────────────────────────────────────
test('the first line is the hello: protocol, ops, the container id, and the script digest', () => {
  const h = harness();
  assert.equal(h.lines.length, 1);
  const [hello] = h.lines;
  assert.equal(hello.t, 'hello');
  assert.equal(hello.proto, 1);
  assert.equal(hello.cid, 'b'.repeat(64));
  assert.deepEqual(hello.sha256, { 'profile.progress': 'a'.repeat(64), 'team.start': 'c'.repeat(64), 'work.stats': 'd'.repeat(64) });
  assert.deepEqual(hello.ops, ['chat.read', 'agents.list', 'agents.team', 'agents.history', 'agents.activity', 'agents.exclusions', 'team.settings', 'agents.screen', 'profile.progress', 'team.start', 'work.stats', 'watch', 'invalidate', 'ping', 'bye']);
});

test('an image without the profile script does not declare that op, and asking for it is an unknown op', async () => {
  const h = harness({ shas: { 'team.start': 'c'.repeat(64), 'work.stats': 'd'.repeat(64) } });
  assert.ok(!h.lines[0].ops.includes('profile.progress'));
  assert.deepEqual(h.lines[0].sha256, { 'team.start': 'c'.repeat(64), 'work.stats': 'd'.repeat(64) });
  h.send({ id: 1, op: 'profile.progress' });
  assert.deepEqual(await h.next(), { t: 'res', id: 1, ok: false, err: 'op_unknown' });
  assert.equal(h.calls.length, 0);
  assert.deepEqual(opsOf(false).includes('profile.progress'), false);
});

test('an image without the team-start script does not declare that op and the other scripts still work', async () => {
  const h = harness({ shas: { 'profile.progress': 'a'.repeat(64), 'work.stats': 'd'.repeat(64) } });
  assert.ok(!h.lines[0].ops.includes('team.start') && h.lines[0].ops.includes('profile.progress'));
  assert.deepEqual(h.lines[0].sha256, { 'profile.progress': 'a'.repeat(64), 'work.stats': 'd'.repeat(64) });
  h.send({ id: 1, op: 'team.start' });
  assert.deepEqual(await h.next(), { t: 'res', id: 1, ok: false, err: 'op_unknown' });
  assert.equal(h.calls.length, 0);
  assert.deepEqual(opsOf(new Set(['profile.progress'])).filter((op) => op === 'team.start' || op === 'profile.progress'), ['profile.progress']);
});

test('the container id: the engine file first, then a 12-hex hostname, else nothing', () => {
  const id = 'c0ffee'.repeat(10) + 'abcd';
  assert.equal(containerId(() => `engine=podman\nid="${id}"\nimage="x"\n`, () => 'whatever'), id);
  const missing = () => { throw new Error('ENOENT'); };
  assert.equal(containerId(missing, () => '0123456789ab'), '0123456789ab');
  assert.equal(containerId(missing, () => 'my-laptop.local'), null);
  assert.equal(containerId(() => 'id="not-hex"\n', () => 'ABCDEF012345'), null);
});

// ── the reads: a closed table, closed arguments ───────────────────────────────────────────────
test('each read runs one absolute argv from the table and returns the reader stdout whole with its exit code', async () => {
  const h = harness({ reply: { exit: 4, out: '{"error":"x"}\n' } });
  h.send({ id: 1, op: 'chat.read', args: { agent: 'capitano', cursor: '123' } });
  h.send({ id: 2, op: 'agents.list' });
  h.send({ id: 3, op: 'agents.team' });
  h.send({ id: 4, op: 'agents.screen', args: { name: 'SCOUT-2' } });
  h.send({ id: 5, op: 'profile.progress' });
  h.send({ id: 6, op: 'agents.history' });
  h.send({ id: 7, op: 'agents.exclusions' });
  h.send({ id: 8, op: 'team.settings' });
  await h.next();
  // (eight reads at a time is the most the stream runs: the ninth waits for the answers)
  h.send({ id: 9, op: 'team.start' });
  h.send({ id: 10, op: 'work.stats' });
  await h.next();
  const argvs = h.calls.map((call) => call.argv);
  assert.deepEqual(argvs[0], ['/usr/bin/python3', '-I', '/app/shared/skills/agent_chat.py', 'read', 'capitano', '123']);
  assert.deepEqual(argvs[1], ['/usr/bin/python3', '-I', '/app/shared/skills/agent_control.py', 'list']);
  assert.deepEqual(argvs[2], ['/usr/bin/python3', '-I', '/app/shared/skills/agent_control.py', 'team']);
  assert.deepEqual(argvs[3], ['/usr/bin/python3', '-I', '/app/shared/skills/agent_control.py', 'screen', 'SCOUT-2']);
  assert.deepEqual(argvs[4], ['/usr/bin/python3', '-I', PROFILE_SCRIPT]);
  assert.equal(h.calls[4].options.stdin, '{"op":"read"}\n');
  assert.deepEqual(argvs[5], ['/usr/bin/python3', '-I', '/app/shared/skills/agent_control.py', 'history']);
  assert.deepEqual(argvs[6], ['/usr/bin/python3', '-I', '/app/shared/skills/agent_control.py', 'exclusions']);
  assert.ok(argvs.every((argv) => argv[0].startsWith('/')));
  const answers = h.lines.filter((line) => line.t === 'res');
  assert.deepEqual(argvs[7], ['/usr/local/bin/node', '/app/cli/bin/jht.js', 'agent-control', 'settings', 'get']);
  assert.deepEqual(argvs[8], ['/usr/bin/python3', '-I', TEAM_START_SCRIPT]);
  assert.equal(h.calls[8].options.stdin, '{"op":"read"}\n');
  assert.deepEqual(argvs[9], ['/usr/bin/python3', '-I', WORK_STATS_SCRIPT]);
  assert.equal(h.calls[9].options.stdin, '{"op":"read","nights":30}\n');
  assert.equal(answers.length, 10);
  assert.deepEqual(answers[0], { t: 'res', id: 1, ok: true, exit: 4, out: '{"error":"x"}\n', age_ms: 0, cached: false });
});

test('a value that could be an option, a list, or too long never reaches a reader (-x, --help, a b, newline, 257 bytes)', async () => {
  const bad = ['-x', '--help', 'a b', 'capitano\n', 'x'.repeat(257), '', '-capitano', 'Capitano'];
  const h = harness();
  let id = 0;
  for (const value of bad) {
    h.send({ id: (id += 1), op: 'chat.read', args: { agent: value } });
    h.send({ id: (id += 1), op: 'agents.screen', args: { name: value } });
  }
  for (const value of [...bad, '12345678901234', '1 2', '1e5']) {
    h.send({ id: (id += 1), op: 'chat.read', args: { agent: 'capitano', cursor: value } });
  }
  h.send({ id: (id += 1), op: 'chat.read', args: { agent: 'capitano', cursor: 5 } });
  h.send({ id: (id += 1), op: 'chat.read', args: { agent: 'capitano', extra: 'x' } });
  h.send({ id: (id += 1), op: 'chat.read' });
  h.send({ id: (id += 1), op: 'agents.list', args: { name: 'x' } });
  h.send({ id: (id += 1), op: 'agents.screen', args: { name: 'SCOUT-2', more: 1 } });
  await h.next();
  assert.equal(h.calls.length, 0);
  const answers = h.lines.filter((line) => line.t === 'res');
  assert.equal(answers.length, id);
  // the rate limit answers `busy` once an op has been asked 10 times in a second: either way, nothing ran
  assert.ok(answers.every((line) => line.ok === false && ['args_invalid', 'busy'].includes(line.err)));
  assert.equal(answers.filter((line) => line.err === 'args_invalid').length >= 10, true);
  assert.deepEqual(h.ended, []);
});

test('the agents\' activity runs agent_control.py activity with one of the page\'s six windows, and nothing else gets that far', async () => {
  const h = harness();
  let id = 0;
  for (const window of ['5m', '15m', '1h', '5h', '24h', '7d']) h.send({ id: (id += 1), op: 'agents.activity', args: { window } });
  await h.next();
  const argvs = h.calls.map((call) => call.argv);
  assert.deepEqual(argvs.map((argv) => argv.slice(0, 4)), Array(6).fill(['/usr/bin/python3', '-I', '/app/shared/skills/agent_control.py', 'activity']));
  assert.deepEqual(argvs.map((argv) => argv[4]), ['5m', '15m', '1h', '5h', '24h', '7d']);
  assert.ok(argvs.every((argv) => argv.length === 5 && argv[0].startsWith('/')));

  const bad = harness();
  let n = 0;
  for (const window of ['', '2h', '1H', '1h ', '-1h', '30d', '1h;x', '5m\n', '--help', 'x'.repeat(257)]) {
    bad.send({ id: (n += 1), op: 'agents.activity', args: { window } });
  }
  bad.send({ id: (n += 1), op: 'agents.activity', args: { window: 3600 } });
  bad.send({ id: (n += 1), op: 'agents.activity', args: { window: '1h', more: 1 } });
  bad.send({ id: (n += 1), op: 'agents.activity' });
  await bad.next();
  assert.equal(bad.calls.length, 0);
  const answers = bad.lines.filter((line) => line.t === 'res');
  assert.equal(answers.length, n);
  assert.ok(answers.every((line) => line.ok === false && ['args_invalid', 'busy'].includes(line.err)));
});

test('an op that is not in the table is answered, not run; an op that is not a string ends the stream', async () => {
  const h = harness();
  h.send({ id: 1, op: 'exec' });
  h.send({ id: 2, op: '__proto__' });
  h.send({ id: 3, op: 'constructor' });
  h.send({ id: 4, op: 'toString' });
  await h.next();
  assert.deepEqual(h.lines.slice(1), [1, 2, 3, 4].map((id) => ({ t: 'res', id, ok: false, err: 'op_unknown' })));
  assert.equal(h.calls.length, 0);
  h.send({ id: 5, op: 7 });
  assert.deepEqual(h.ended, [EXIT_PROTOCOL]);
});

// ── a hostile peer ends the stream ────────────────────────────────────────────────────────────
test('a line over the cap ends the stream, finished or not', () => {
  const finished = harness();
  finished.send(`{"id":1,"op":"ping","args":{"x":"${'a'.repeat(MAX_LINE)}"}}`);
  assert.deepEqual(finished.ended, [EXIT_PROTOCOL]);
  const unfinished = harness();
  unfinished.stream.push('x'.repeat(MAX_LINE + 1));
  assert.deepEqual(unfinished.ended, [EXIT_PROTOCOL]);
});

test('a line of exactly the cap is accepted; one byte more is not (bytes, not characters)', () => {
  const pad = (n) => `{"id":1,"op":"ping","args":"${'a'.repeat(n)}"}`;
  const base = Buffer.byteLength(pad(0), 'utf8');
  const ok = harness();
  ok.send(pad(MAX_LINE - base));
  assert.deepEqual(ok.ended, []);
  const wide = harness();
  // 'è' is two bytes: this line is under the cap in characters and over it in bytes
  wide.send(`{"id":1,"op":"ping","args":"${'è'.repeat(MAX_LINE / 2)}"}`);
  assert.deepEqual(wide.ended, [EXIT_PROTOCOL]);
});

test('depth 9 ends the stream, depth 8 does not; brackets inside a string do not count', () => {
  const nest = (n) => `${'['.repeat(n)}${']'.repeat(n)}`;
  assert.equal(depthOf(`{"a":${nest(7)}}`), 8);
  assert.equal(depthOf('{"a":"[[[[[[[[[[[["}'), 1);
  assert.equal(depthOf('{"a":"\\"[[[[[[[[[[["}'), 1);
  const deep = harness();
  deep.send(`{"id":1,"op":"ping","args":${nest(8)}}`);
  assert.deepEqual(deep.ended, [EXIT_PROTOCOL]);
  const shallow = harness();
  shallow.send(`{"id":1,"op":"ping","args":${nest(7)}}`);
  assert.deepEqual(shallow.ended, []);
});

test('a repeated, falling or out-of-range id, a bad key, and text that is not JSON end the stream', () => {
  for (const second of [{ id: 5, op: 'ping' }, { id: 4, op: 'ping' }]) {
    const h = harness();
    h.send({ id: 5, op: 'ping' });
    h.send(second);
    assert.deepEqual(h.ended, [EXIT_PROTOCOL]);
  }
  for (const bad of [{ id: 0, op: 'ping' }, { id: -1, op: 'ping' }, { id: 1.5, op: 'ping' }, { id: '1', op: 'ping' }, { id: 2 ** 31, op: 'ping' },
    { op: 'ping' }, { id: 1, op: 'ping', note: 'x' }, [1, 2], 'null', '{', '{"id":1,"op":"ping"} x', '"ping"', '7']) {
    const h = harness();
    h.send(bad);
    assert.deepEqual(h.ended, [EXIT_PROTOCOL], JSON.stringify(bad));
  }
});

test('stdin closed in the middle of a line: the process ends with 0, answers nothing, and kills what is running', async () => {
  const never = new Promise(() => {});
  const h = harness({ reply: () => never });
  h.send({ id: 1, op: 'agents.list' });
  h.stream.push('{"id":2,"op":"pi');
  let killed = 0;
  for (const set of h.killers) set.add(() => { killed += 1; });
  h.stream.close();
  assert.deepEqual(h.ended, [0]);
  assert.equal(killed, 1);
  assert.equal(h.lines.length, 1);
});

test('nothing for a minute and the process ends by itself', () => {
  const h = harness();
  h.idle();
  assert.deepEqual(h.ended, [0]);
});

test('after the stream has ended nothing more is written or run', async () => {
  const h = harness();
  h.send({ id: 1, op: 'ping' });
  h.send({ id: 1, op: 'ping' });
  const written = h.lines.length;
  h.send({ id: 9, op: 'agents.list' });
  await h.next();
  assert.equal(h.lines.length, written);
  assert.equal(h.calls.length, 0);
});

// ── limits ────────────────────────────────────────────────────────────────────────────────────
test('an answer whose ENCODED line is over the cap is `too_big`, not a line the app would refuse', async () => {
  const control = '\u0001'.repeat(60 * 1024); // 60 KiB of text, ~360 KiB once escaped
  const h = harness({ reply: { exit: 0, out: control } });
  h.send({ id: 1, op: 'agents.list' });
  assert.deepEqual(await h.next(), { t: 'res', id: 1, ok: false, err: 'too_big' });
  assert.deepEqual(h.ended, []);
});

test('at most 8 reads in flight and 10 of one op in a second; a rate-limited ask is answered `busy`', async () => {
  const gate = [];
  const h = harness({ reply: () => new Promise((resolve) => gate.push(resolve)) });
  const scouts = ['capitano', 'assistente', 'mentor', 'scout', 'analista', 'scorer', 'scrittore', 'critico'];
  scouts.forEach((agent, index) => h.send({ id: index + 1, op: 'chat.read', args: { agent } }));
  h.send({ id: 9, op: 'agents.list' });
  assert.deepEqual(h.lines.at(-1), { t: 'res', id: 9, ok: false, err: 'busy' });
  gate.forEach((resolve) => resolve({ exit: 0, out: '{}' }));
  await h.next();
  const limited = harness();
  for (let id = 1; id <= 11; id += 1) limited.send({ id, op: 'ping' });
  assert.deepEqual(limited.lines.at(-1), { t: 'res', id: 11, ok: false, err: 'busy' });
  assert.equal(limited.lines.filter((line) => line.t === 'pong').length, 10);
  limited.tick(1001);
  limited.send({ id: 12, op: 'ping' });
  assert.deepEqual(limited.lines.at(-1), { t: 'pong', id: 12 });
});

test('the same ask at the same time is one run; the answer is kept for the op ttl and the key holds every argument', async () => {
  let release;
  const h = harness({ reply: () => new Promise((resolve) => { release = resolve; }) });
  h.send({ id: 1, op: 'chat.read', args: { agent: 'capitano', cursor: '1' } });
  h.send({ id: 2, op: 'chat.read', args: { cursor: '1', agent: 'capitano' } });
  assert.equal(h.calls.length, 1);
  release({ exit: 0, out: '{"a":1}' });
  await h.next();
  assert.equal(h.lines.filter((line) => line.t === 'res').length, 2);
  // kept
  h.tick(100);
  h.send({ id: 3, op: 'chat.read', args: { agent: 'capitano', cursor: '1' } });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.lines.at(-1), { t: 'res', id: 3, ok: true, exit: 0, out: '{"a":1}', age_ms: 100, cached: true });
  // another cursor, another agent: other runs
  h.send({ id: 4, op: 'chat.read', args: { agent: 'capitano', cursor: '2' } });
  h.send({ id: 5, op: 'chat.read', args: { agent: 'mentor', cursor: '1' } });
  h.send({ id: 6, op: 'chat.read', args: { agent: 'capitano' } });
  assert.equal(h.calls.length, 4);
  // older than the ttl (300 ms): run again
  h.tick(400);
  h.send({ id: 7, op: 'chat.read', args: { agent: 'capitano', cursor: '1' } });
  assert.equal(h.calls.length, 5);
});

test('an error or a non-zero exit is not kept: the next ask runs again', async () => {
  let n = 0;
  const h = harness({ reply: () => Promise.resolve(n++ === 0 ? { err: 'timeout' } : n === 2 ? { exit: 101, out: '{"ok":false}' } : { exit: 0, out: '{}' }) });
  h.send({ id: 1, op: 'agents.list' });
  assert.deepEqual(await h.next(), { t: 'res', id: 1, ok: false, err: 'timeout' });
  h.send({ id: 2, op: 'agents.list' });
  assert.deepEqual(await h.next(), { t: 'res', id: 2, ok: true, exit: 101, out: '{"ok":false}', age_ms: 0, cached: false });
  h.send({ id: 3, op: 'agents.list' });
  await h.next();
  h.send({ id: 4, op: 'agents.list' });
  assert.equal(h.calls.length, 3);
  assert.equal(h.lines.at(-1).cached, true);
});

test('what is kept is bounded: 1000 different cursors keep at most 64 entries, and the ones past their time go', async () => {
  const h = harness({ reply: { exit: 0, out: '{"messages":[]}' } });
  for (let n = 1; n <= 1000; n += 1) {
    h.send({ id: n, op: 'chat.read', args: { agent: 'capitano', cursor: String(n) } });
    await h.next();
    h.tick(10); // the ask rate stays under 10 a second by the fake clock being moved on
    if (n % 9 === 0) h.tick(1000);
  }
  assert.ok(h.stream.kept() <= CACHE_MAX_ENTRIES, h.stream.kept());
  // answers past their time are dropped when the next one is put away
  h.tick(10_000);
  h.send({ id: 1001, op: 'agents.list' });
  await h.next();
  assert.equal(h.stream.kept(), 1);
});

test('what is kept is bounded in bytes too: big answers push the oldest out', async () => {
  // 1.5 MiB each (too big to send as a line, but they are put away): three fit in the time, two in the bytes
  const big = 'x'.repeat(1.5 * 1024 * 1024);
  const h = harness({ reply: { exit: 0, out: big } });
  for (let n = 1; n <= 12; n += 1) {
    h.send({ id: n, op: 'chat.read', args: { agent: 'capitano', cursor: String(n) } });
    await h.next();
    assert.ok(h.stream.kept() * big.length <= CACHE_MAX_BYTES, `${n}: ${h.stream.kept()}`);
    h.tick(100);
  }
  assert.equal(h.stream.kept(), 2);
});

test('invalidate drops what is kept', async () => {
  const h = harness();
  h.send({ id: 1, op: 'agents.list' });
  await h.next();
  h.send({ id: 2, op: 'invalidate' });
  h.send({ id: 3, op: 'agents.list' });
  await h.next();
  assert.equal(h.calls.length, 2);
});

test('bye answers and ends with 0', () => {
  const h = harness();
  h.send({ id: 1, op: 'bye' });
  assert.deepEqual(h.lines.at(-1), { t: 'res', id: 1, ok: true });
  assert.deepEqual(h.ended, [0]);
});

// ── the hints ─────────────────────────────────────────────────────────────────────────────────
test('watch takes a closed set of topics (at most 12) and nothing else', () => {
  const h = harness();
  const refused = [
    { topics: ['piles'] }, { topics: ['chat:'] }, { topics: ['chat:-x'] }, { topics: ['chat:root'] }, { topics: [7] }, { topics: 'agents' }, { topics: ['agents'], more: 1 },
    { topics: Array.from({ length: 13 }, (_, i) => (i % 2 ? 'agents' : 'profile')) },
  ];
  refused.forEach((args, index) => h.send({ id: index + 1, op: 'watch', args }));
  const answers = h.lines.filter((line) => line.t === 'res');
  assert.ok(answers.every((line) => line.ok === false && line.err === 'args_invalid'));
  assert.equal(answers.length, refused.length);
  h.send({ id: 20, op: 'watch', args: { topics: ['agents', 'profile', 'chat:capitano'] } });
  assert.deepEqual(h.lines.at(-1), { t: 'res', id: 20, ok: true });
  h.stream.close();
});

test('the hint arrives when a sweep sees a different file, once, with rev 1, then 2', async () => {
  const state = { sig: '1:10' };
  const lines = [];
  let ended;
  const stream = createStateStream({
    write: (line) => lines.push(JSON.parse(line)),
    end: (code) => { ended = code; },
    run: () => Promise.resolve({ exit: 0, out: '{}' }),
    stat: () => state.sig,
    cid: () => null,
    scriptSha: () => null,
    home: '/jht_home',
  });
  stream.hello();
  stream.push('{"id":1,"op":"watch","args":{"topics":["chat:scout"]}}\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  state.sig = '2:20';
  await new Promise((resolve) => setTimeout(resolve, 1300));
  state.sig = '3:30';
  await new Promise((resolve) => setTimeout(resolve, 1300));
  stream.close();
  const hints = lines.filter((line) => line.t === 'ev');
  assert.deepEqual(hints, [{ t: 'ev', topic: 'chat:scout', rev: 1 }, { t: 'ev', topic: 'chat:scout', rev: 2 }]);
  assert.equal(ended, 0);
});

test('settings and positions are topics; positions gives one hint per 10 s at most, and the last change always gets one', async () => {
  const state = { sig: '1:10', at: 1_000_000 };
  const lines = [];
  const stream = createStateStream({
    write: (line) => lines.push(JSON.parse(line)),
    end: () => {},
    run: () => Promise.resolve({ exit: 0, out: '{}' }),
    stat: () => state.sig,
    now: () => state.at,
    cid: () => null,
    scriptSha: () => null,
    home: '/jht_home',
  });
  stream.hello();
  stream.push('{"id":1,"op":"watch","args":{"topics":["settings","positions"]}}\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(lines.find((line) => line.id === 1)?.ok, true);
  const hints = () => lines.filter((line) => line.t === 'ev').map((line) => `${line.topic}:${line.rev}`);
  state.sig = '2:20';
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(hints(), ['settings:1', 'positions:1']);
  // two more changes 4 s apart: the settings hint each time (3 s apart at least), the positions wait for their 10 s
  state.at += 4000; state.sig = '3:30';
  await new Promise((resolve) => setTimeout(resolve, 1200));
  state.at += 4000; state.sig = '4:40';
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(hints(), ['settings:1', 'positions:1', 'settings:2', 'settings:3']);
  // a change inside the settings' 3 s is held back, and the trailing hint comes once the time has passed
  state.at += 1000; state.sig = '5:50';
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(hints(), ['settings:1', 'positions:1', 'settings:2', 'settings:3'], 'held back');
  state.at += 3000;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(hints(), ['settings:1', 'positions:1', 'settings:2', 'settings:3', 'settings:4', 'positions:2'], 'the trailing hints: settings after its 3 s, positions after its 10 s, once each');
  stream.close();
});

test('a change of the settings drops the kept team.settings read', async () => {
  const state = { sig: '1:10' };
  const calls = [];
  const lines = [];
  const stream = createStateStream({
    write: (line) => lines.push(JSON.parse(line)),
    end: () => {},
    run: (argv) => { calls.push(argv); return Promise.resolve({ exit: 0, out: '{"ok":true}\n' }); },
    stat: () => state.sig,
    cid: () => null,
    scriptSha: () => null,
    home: '/jht_home',
  });
  stream.hello();
  stream.push('{"id":1,"op":"watch","args":{"topics":["settings"]}}\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  stream.push('{"id":2,"op":"team.settings"}\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  stream.push('{"id":3,"op":"team.settings"}\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.length, 1, 'the second ask is served from what is kept');
  state.sig = '2:20';
  await new Promise((resolve) => setTimeout(resolve, 1300));
  stream.push('{"id":4,"op":"team.settings"}\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.length, 2);
  stream.close();
});

// ── the one place that runs a program ─────────────────────────────────────────────────────────
test('runReader: stdout whole and the exit code; a non-zero exit is an answer, not an error', async () => {
  const done = await runReader([process.execPath, '-e', 'process.stdout.write("hi\\n"); process.exit(7)'], { cwd: '/', timeoutMs: 5000 });
  assert.deepEqual(done, { exit: 7, out: 'hi\n' });
  assert.deepEqual(await runReader(['/nonexistent/program'], { cwd: '/', timeoutMs: 5000 }), { err: 'reader_failed' });
});

test('runReader: gives the reader stdin, an explicit environment, and no shell', async () => {
  const code = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({s,env:Object.keys(process.env).sort()})))';
  const env = { PATH: '/usr/bin', JHT_HOME: '/h' };
  const done = await runReader([process.execPath, '-e', code], { stdin: 'line\n', cwd: '/', env, timeoutMs: 5000 });
  const seen = JSON.parse(done.out);
  assert.equal(seen.s, 'line\n');
  assert.ok(seen.env.every((key) => ['PATH', 'JHT_HOME'].includes(key) || key.startsWith('__CF')), seen.env.join());
  assert.equal((await runReader([process.execPath, '-e', 'process.stdout.write(process.argv[1])', '$(echo x); y'], { cwd: '/', env, timeoutMs: 5000 })).out, '$(echo x); y');
});

test('runReader: a reader that hangs is killed with its whole group at the timeout', async () => {
  const code = 'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});console.log(c.pid);setInterval(()=>{},1000)';
  const track = new Set();
  const started = Date.now();
  const child = runReader([process.execPath, '-e', code], { cwd: '/', timeoutMs: 600, track });
  const done = await child;
  assert.deepEqual(done, { err: 'timeout' });
  assert.ok(Date.now() - started < 4000);
  assert.equal(track.size, 0);
});

test('runReader: a reader that writes more than the cap is stopped', async () => {
  const done = await runReader([process.execPath, '-e', 'const fs=require("node:fs");for(;;){try{fs.writeSync(1,"x".repeat(65536))}catch(e){if(e.code!=="EAGAIN")process.exit(0)}}'], { cwd: '/', maxStdout: 200_000, timeoutMs: 5000 });
  assert.deepEqual(done, { err: 'too_big' });
});

test('the environment of a reader is a fixed PATH and a few of the image variables, nothing else', () => {
  const env = readerEnv({ PATH: '/app/agents/_tools:/opt/jht-deps/bin', HOME: '/jht_home', JHT_HOME: '/jht_home', NODE_OPTIONS: '--require=/x', PYTHONPATH: '/y', LD_PRELOAD: '/z', LANG: 'C.UTF-8', SECRET: 's' });
  assert.deepEqual(env, { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/jht_home', JHT_HOME: '/jht_home', LANG: 'C.UTF-8' });
});

// ── tests of the source: what the channel can and cannot do ───────────────────────────────────
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('source: one place runs a program, with no shell, and nothing is written, opened as a database, or listened on', () => {
  assert.equal((CODE.match(/\bspawn\(/g) ?? []).length, 1);
  for (const forbidden of ['shell: true', 'execSync', 'execFile', 'spawnSync', 'fork(', 'exec(', 'eval(', 'new Function', 'writeFile', 'appendFile', 'mkdir', 'unlink', 'rename', 'createWriteStream',
    'openSync', 'sqlite', 'createServer', 'listen(', 'fetch(', 'node:net', 'node:http', 'node:dgram', 'node:worker_threads', 'import(', 'require(']) {
    assert.ok(!CODE.includes(forbidden) || (forbidden === 'exec(' && !/(^|[^.\w])exec\(/.test(CODE)), forbidden);
  }
  // the only thing taken from child_process is `spawn`
  assert.deepEqual([...CODE.matchAll(/import \{([^}]*)\} from 'node:child_process'/g)].map((m) => m[1].trim()), ['spawn']);
  // files are only read or stat'ed
  assert.deepEqual([...new Set([...CODE.matchAll(/\b(readFileSync|statSync)\b/g)].map((m) => m[1]))].sort(), ['readFileSync', 'statSync']);
  assert.ok(!/from 'node:fs'.*\b(write|append|chmod|chown|truncate|copy|symlink|link)\w*/.test(CODE));
});

test('source: the table holds absolute programs only, and every program is one of python3, node, tmux', () => {
  assert.ok(/const PYTHON = '\/usr\/bin\/python3'/.test(CODE) && /const TMUX = '\/usr\/bin\/tmux'/.test(CODE));
  assert.ok(/const CWD|export const CWD = '\/app'/.test(CODE));
  for (const reader of Object.values(READERS)) {
    const sample = reader === READERS['chat.read'] ? { agent: 'capitano' } : reader === READERS['agents.screen'] ? { name: 'CAPITANO' } : reader === READERS['agents.activity'] ? { window: '1h' } : undefined;
    const argv = reader.argv(sample);
    if (reader === READERS['team.settings']) {
      assert.deepEqual(argv, ['/usr/local/bin/node', '/app/cli/bin/jht.js', 'agent-control', 'settings', 'get']);
      continue;
    }
    assert.ok(argv[0] === '/usr/bin/python3' && argv[1] === '-I' && argv[2].startsWith('/app/shared/skills/'), argv.join(' '));
    assert.ok(!argv.slice(3).some((word) => word.startsWith('-')));
  }
});

test('source: the chat agents are the app list, and the profile script is the app constant byte for byte', () => {
  const rust = readFileSync(join(ROOT, 'desktop/src-tauri/src/existing_team_runtime.rs'), 'utf8');
  const listed = /const CHAT_AGENTS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rust)[1].match(/"([a-z]+)"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(CHAT_AGENTS, listed);
  const progress = readFileSync(join(ROOT, 'desktop/src-tauri/src/profile_progress.rs'), 'utf8');
  const constant = /const PROFILE_PROGRESS_PY: &str = r#"([\s\S]*?)"#;/.exec(progress)[1];
  assert.equal(readFileSync(join(ROOT, 'shared/skills/profile_progress.py'), 'utf8'), constant);
  const start = readFileSync(join(ROOT, 'desktop/src-tauri/src/team_start.rs'), 'utf8');
  const startConstant = /const TEAM_START_PY: &str = r#"([\s\S]*?)"#;/.exec(start)[1];
  assert.equal(readFileSync(join(ROOT, 'shared/skills/team_start.py'), 'utf8'), startConstant);
  const stats = readFileSync(join(ROOT, 'desktop/src-tauri/src/work_stats.rs'), 'utf8');
  const statsConstant = /const WORK_STATS_PY: &str = r#"([\s\S]*?)"#;/.exec(stats)[1];
  assert.equal(readFileSync(join(ROOT, 'shared/skills/work_stats_read.py'), 'utf8'), statsConstant);
});

// ── the real command, over a pipe ─────────────────────────────────────────────────────────────
function command() {
  const child = spawn(process.execPath, [join(ROOT, 'cli/bin/jht.js'), 'state-stream'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  const lines = () => out.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const waitFor = async (count) => {
    for (let i = 0; i < 200 && lines().length < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    return lines();
  };
  return { child, exited, lines, waitFor };
}

test('command: hello, ping and pong, bye; and stdin closed ends it with 0', async () => {
  const one = command();
  const [hello] = await one.waitFor(1);
  assert.equal(hello.t, 'hello');
  assert.equal(hello.proto, 1);
  one.child.stdin.write('{"id":1,"op":"ping"}\n{"id":2,"op":"nope"}\n');
  const lines = await one.waitFor(3);
  assert.deepEqual(lines.slice(1), [{ t: 'pong', id: 1 }, { t: 'res', id: 2, ok: false, err: 'op_unknown' }]);
  one.child.stdin.end();
  assert.equal(await one.exited, 0);
  const two = command();
  await two.waitFor(1);
  two.child.stdin.write('{"id":1,"op":"bye"}\n');
  assert.equal(await two.exited, 0);
});

test('command: a line of 257 KiB, depth 9, a repeated id, and a line cut in half', async () => {
  const wrong = [
    `{"id":1,"op":"ping","args":"${'a'.repeat(MAX_LINE)}"}\n`,
    `{"id":1,"op":"ping","args":${'['.repeat(9)}${']'.repeat(9)}}\n`,
    '{"id":3,"op":"ping"}\n{"id":3,"op":"ping"}\n',
  ];
  for (const bytes of wrong) {
    const one = command();
    await one.waitFor(1);
    one.child.stdin.write(bytes);
    assert.equal(await one.exited, EXIT_PROTOCOL);
  }
  const cut = command();
  await cut.waitFor(1);
  cut.child.stdin.end('{"id":1,"op":"pi');
  assert.equal(await cut.exited, 0);
  assert.equal(cut.lines().length, 1);
});
