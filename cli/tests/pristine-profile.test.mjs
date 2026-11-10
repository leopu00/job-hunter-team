// The CLI on a profile where nothing has been set up yet answers in words and never crashes (T319 class).
//
// T319: a state that is read only exists after a first pass, and the computer the code was tried on already had it,
// so the defect stayed hidden until a clean one. Every command here is a READ (it shows, lists or checks) and runs
// with an EMPTY home: no config, no database, no logs, no credentials, no profile. Each one must end with its words
// and an exit code that is an answer, never with a stack trace, a raw ENOENT or an uncaught error. If a command is
// renamed the test says so (`unknown command`) instead of passing on an error message.
//
// Made-up empty homes only. Nothing outside the temporary folder is read or written.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const JHT = resolve(import.meta.dirname, '../bin/jht.js');
const SKIP = process.platform === 'win32' ? 'the runtime home and its folders are POSIX; Windows has its own wrapper tests' : false;

// [the words of the command, the exit codes that are an answer]
const PRISTINE_READS = [
  ['status', [0]],
  ['agents', [0]],
  ['doctor', [0, 1]],
  ['logs', [0]],
  ['positions', [0]],
  ['working-hours show', [0, 1]],
  ['cron list', [0]],
  ['profile show', [0, 1]],
  ['notifications list', [0]],
  ['standby status', [0]],
  ['burn status', [0]],
  ['providers', [0]],
  ['report', [0]],
  ['health', [0, 1]],
  ['config get', [0, 1]],
  ['cache stats', [0]],
  ['tools stats', [0, 1]],
  ['sentinella status', [0]],
  ['directives', [0]],
  ['backup list', [0]],
  ['cloud status', [0]],
  ['secrets list', [0]],
  ['coordinator show', [0]],
  ['ticket list', [0]],
  ['team status', [0]],
  ['team list', [0]],
  ['migrate', [0, 1]],
];

// What a crash looks like in the text, whatever the command.
const CRASH = /ENOENT|ENOTDIR|EACCES|TypeError|ReferenceError|RangeError|SyntaxError|Unexpected token|Unhandled|uncaught|Cannot read|is not a function|^\s+at .*[:(]\d+:\d+\)?$/im;

function runOnEmptyHome(words) {
  const home = mkdtempSync(join(tmpdir(), 'jht-pristine-'));
  const done = spawnSync(process.execPath, [JHT, ...words.split(' ')], {
    encoding: 'utf8', timeout: 60000, cwd: home,
    env: { PATH: process.env.PATH, HOME: home, JHT_HOME: join(home, '.jht'), TMPDIR: home, NO_COLOR: '1', JHT_LANG: 'en' },
  });
  return { done, home, text: `${done.stdout ?? ''}${done.stderr ?? ''}` };
}

for (const [words, answers] of PRISTINE_READS) {
  test(`jht ${words} on an empty home answers in words and does not crash`, { skip: SKIP }, () => {
    const { done, text } = runOnEmptyHome(words);
    assert.equal(done.error, undefined, `did not run: ${done.error}`);
    assert.equal(done.signal, null, `killed by ${done.signal}`);
    assert.doesNotMatch(text, /unknown command|too many arguments/i, `the command is not there any more: ${text.slice(0, 200)}`);
    assert.doesNotMatch(text, CRASH, text.slice(0, 600));
    assert.ok(answers.includes(done.status), `exit ${done.status}, expected one of ${answers}: ${text.slice(0, 300)}`);
    assert.ok(text.trim().length > 0 || done.status === 0, 'an error with no words');
  });
}

test('the reads that say "not set up yet" name the command that sets it up', { skip: SKIP }, () => {
  for (const [words, hint] of [['working-hours show', /jht setup/], ['migrate', /jht setup/], ['config get', /no configuration yet/]]) {
    const { text } = runOnEmptyHome(words);
    assert.match(text, hint, `${words}: ${text.slice(0, 200)}`);
  }
});

test('a read of a profile that has no data says there is none, and is not an error', { skip: SKIP }, () => {
  // positions, directives and ticket do not even open the database that is not there (cli/tests/reads-do-not-write.test.mjs): one sentence for the three
  const NOTHING = /Nothing here yet: the team has not run on this computer\. Start it with: jht team start/;
  for (const [words, hint] of [['positions', NOTHING], ['cron list', /No job configured/], ['directives', NOTHING],
    ['backup list', /No backup found/], ['ticket list', NOTHING], ['logs', /No log files found/]]) {
    const { done, text } = runOnEmptyHome(words);
    assert.equal(done.status, 0, `${words}: exit ${done.status}`);
    assert.match(text, hint, `${words}: ${text.slice(0, 200)}`);
  }
});

test('a read never leaves anything but the home folder it was given', { skip: SKIP }, () => {
  const { home } = runOnEmptyHome('status');
  const inside = readdirSync(home);
  assert.ok(inside.every((name) => name === '.jht'), `unexpected files in the home: ${inside}`);
});
