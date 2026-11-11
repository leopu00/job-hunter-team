// A command that only reads makes nothing (audit of 10/11): on a home where the team never ran, `jht positions`, `ticket`, `directives` do not
// create jobs.db and `jht secrets list` does not create credentials/; each says there is nothing yet. Made-up homes only.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { nothingYetAnswer } from '../src/commands/positions.js';

const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));
const jht = (home, ...args) => {
  const r = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', env: { ...process.env, JHT_HOME: home, NO_COLOR: '1', JHT_LANG: 'en' } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const empty = () => mkdtempSync(join(tmpdir(), 'jht-reads-'));

const NOTHING = /Nothing here yet: the team has not run on this computer\. Start it with: jht team start/;

test('the reads of the database answer «nothing yet» and leave the home empty', () => {
  const reads = [
    ['positions', 'list'], ['positions', 'dashboard'],
    ['ticket', 'list'], ['ticket', 'count'], ['directives', 'list'], ['directives'],
  ];
  for (const args of reads) {
    const home = empty();
    const r = jht(home, ...args);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.out}`);
    assert.match(r.out, NOTHING, args.join(' '));
    assert.deepEqual(readdirSync(home), [], `${args.join(' ')} left something behind`);
  }
});

test('asking for ONE thing by its id on an empty home is «not there» (exit 1) and still creates nothing', () => {
  for (const args of [['positions', 'show', '1'], ['ticket', 'show', '3']]) {
    const home = empty();
    const r = jht(home, ...args);
    assert.equal(r.code, 1, `${args.join(' ')}: ${r.out}`);
    assert.match(r.out, NOTHING);
    assert.deepEqual(readdirSync(home), []);
  }
});

test('--json answers an empty list or an empty object, for the program that reads it', () => {
  const home = empty();
  assert.equal(jht(home, 'positions', 'list', '--json').out.trim(), '[]');
  assert.equal(jht(home, 'positions', 'dashboard', '--json').out.trim(), '{}');
  assert.deepEqual(readdirSync(home), []);
});

test('secrets list on a home with no credentials folder says none saved and does not make the folder', () => {
  const home = empty();
  const r = jht(home, 'secrets', 'list');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Secrets.*\(0\)/s);
  assert.match(r.out, /No secret saved/);
  assert.deepEqual(readdirSync(home), []);
});

test('only reads are answered this way: the writes and the queue of the agents go on to the skill, and so does a database that is there', () => {
  const none = () => false;
  for (const [skill, sub] of [['team_directives.py', 'add'], ['team_directives.py', 'edit'], ['team_directives.py', 'archive'],
    ['ticket.py', 'open'], ['ticket.py', 'resolve'], ['ticket.py', 'assign'], ['db_query.py', 'next-for-scorer'], ['db_query.py', 'next-for-analista']]) {
    assert.equal(nothingYetAnswer(skill, [sub], '/no/such/jobs.db', none), null, `${skill} ${sub}`);
  }
  for (const [skill, sub] of [['db_query.py', 'positions'], ['ticket.py', 'list-open'], ['team_directives.py', 'active']]) {
    assert.equal(nothingYetAnswer(skill, [sub], '/there/jobs.db', () => true), null, 'the database is there: the skill answers');
    assert.ok(nothingYetAnswer(skill, [sub], '/no/such/jobs.db', none), `${skill} ${sub} on a home with no database`);
  }
  const home = empty();
  writeFileSync(join(home, 'jobs.db'), '');
  assert.equal(nothingYetAnswer('db_query.py', ['positions'], join(home, 'jobs.db')), null);
});
