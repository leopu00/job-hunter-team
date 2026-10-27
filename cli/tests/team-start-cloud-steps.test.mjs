// `jht team start` on a local team (no cloud linked) printed «desired-state pull / ticket sync / directive sync
// not applied» as if something had failed. The three cloud steps exited 1 when there is no cloud even with
// --silent (and said nothing why), and the start printed the last line of their stderr, which on Node 22 was
// Node's own «(Use `node --trace-warnings ...`)» about the experimental SQLite module.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { syncNotApplied } from '../src/commands/team/start.js';

const JHT = resolve(import.meta.dirname, '../bin/jht.js');

function cloudStep(step, extra = [], env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jht-cloudstep-'));
  const r = spawnSync(process.execPath, [...extra, JHT, 'cloud', step, ...(env.manual ? [] : ['--silent'])], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, JHT_HOME: home, HOME: home, NO_COLOR: '1', JHT_LANG: 'en' },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, home };
}

const WARNING = "(node:4242) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n"
  + '(Use `node --trace-warnings ...` to show where the warning was created)\n';

for (const step of ['pull-desired-state', 'sync-tickets', 'sync-directives', 'pull-profile']) {
  test(`${step} at boot on a machine without a cloud: exit 0, nothing said`, () => {
    const r = cloudStep(step);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.doesNotMatch(r.stderr, /not enabled|not applied/i);
  });
}

for (const step of ['pull-desired-state', 'sync-tickets', 'sync-directives']) {
  test(`${step} by hand without a cloud still says so and fails`, () => {
    const r = cloudStep(step, [], { manual: true });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Cloud sync is not enabled/);
  });
}

test('what the start prints for a step: nothing when it worked or when there is no cloud', () => {
  assert.equal(syncNotApplied('ticket sync', { code: 0, stderr: WARNING }), null);
  assert.equal(syncNotApplied('ticket sync', { code: 1, stderr: 'Cloud sync is not enabled.\n' }), null);
  assert.equal(syncNotApplied('ticket sync', { code: 1, stderr: `${WARNING}Cloud sync non abilitato\n` }), null);
  assert.equal(syncNotApplied('ticket sync', undefined), null);
});

test('a step that failed says so even when it left nothing, or only Node\'s own warnings', () => {
  assert.equal(syncNotApplied('desired-state pull', { code: 1, stderr: WARNING }),
    '  ℹ desired-state pull not applied: exit code 1');
  assert.equal(syncNotApplied('ticket sync', { code: 3, stderr: '' }), '  ℹ ticket sync not applied: exit code 3');
  assert.equal(syncNotApplied('ticket sync', { code: null }), '  ℹ ticket sync not applied: exit code unknown');
});

test("Node's own warnings are never the reason a step gives", () => {
  assert.equal(
    syncNotApplied('desired-state pull', { code: 1, stderr: `${WARNING}pull-desired-state: HTTP 503\n${WARNING}` }),
    '  ℹ desired-state pull not applied: pull-desired-state: HTTP 503');
});

test('«not enabled» in an earlier line does not hide a real failure that follows', () => {
  assert.equal(
    syncNotApplied('directive sync', { code: 1, stderr: 'cloud sync is not enabled for the old board\nsync-directives: HTTP 500\n' }),
    '  ℹ directive sync not applied: sync-directives: HTTP 500');
});

test('a real failure keeps its last line, as before', () => {
  assert.equal(syncNotApplied('directive sync', { code: 1, stderr: 'a\nb: network error\n' }),
    '  ℹ directive sync not applied: b: network error');
});

test('the warning Node 22 prints does not change what the step does on a machine without a cloud', () => {
  const home = mkdtempSync(join(tmpdir(), 'jht-warn-'));
  const warn = join(home, 'warn.cjs');
  writeFileSync(warn, "process.emitWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning');\n");
  const r = cloudStep('sync-tickets', ['--require', warn]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /ExperimentalWarning/);
  assert.equal(syncNotApplied('ticket sync', { code: r.status, stderr: r.stderr }), null);
});
