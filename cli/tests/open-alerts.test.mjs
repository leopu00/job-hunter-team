// The alerts for the person that nobody has read (pending_user_messages kind=alert): the Capitano's «no spending ceiling»
// went only to the web, and whoever uses the terminal never saw it (collaudo Linux, 15/11). jht team status and jht team
// start say them now. Synthetic databases in made-up homes; nothing is marked as read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

process.env.JHT_LANG = 'en';
const { openAlerts, openAlertLines } = await import('../src/lib/open-alerts.js');
const JHT = fileURLToPath(new URL('../bin/jht.js', import.meta.url));
const CEILING = 'No spending ceiling is set for this key: set a budget with jht setup, or a limit on the site of the provider.';

function home(rows) {
  const root = mkdtempSync(join(tmpdir(), 'jht-alerts-'));
  const db = new DatabaseSync(join(root, 'jobs.db'));
  db.exec(`CREATE TABLE pending_user_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'notification', author TEXT NOT NULL DEFAULT 'agent', source_id TEXT, delivered_via TEXT,
    acknowledged_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  const put = db.prepare(`INSERT INTO pending_user_messages (agent, body, kind, author, source_id, delivered_via, acknowledged_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'web', ?, datetime('now', ?))`);
  for (const r of rows) put.run(r.agent ?? 'capitano', r.body, r.kind ?? 'alert', r.author ?? 'agent', r.source ?? null, r.ack ?? null, r.age ?? '-1 minutes');
  db.close();
  return root;
}

test('an alert nobody read is said, newest first, one per source; read, old, other kinds and the person\'s own lines are not', async () => {
  const root = home([
    { body: 'an older copy of the same notice', source: 'no-quota-mode-x', age: '-2 hours' },
    { body: CEILING, source: 'no-quota-mode-x' },
    { agent: 'sentinella', body: 'The box no longer reaches the website.', age: '-30 minutes' },
    { body: 'already read on the web', ack: '2026-11-15 20:00:00' },
    { body: 'ten days ago', age: '-10 days' },
    { body: 'ten positions above 75', kind: 'notification' },
    { body: 'a line the person wrote', author: 'user' },
  ]);
  const alerts = await openAlerts({ dbPath: join(root, 'jobs.db') });
  assert.deepEqual(alerts.map((a) => [a.agent, a.body]), [['capitano', CEILING], ['sentinella', 'The box no longer reaches the website.']]);
  assert.deepEqual(await openAlertLines({ dbPath: join(root, 'jobs.db') }), [
    `Capitano says: ${CEILING}`,
    'Sentinella says: The box no longer reaches the website.',
    'Also in the chat with the Assistente (jht team chat assistente) and in the Messages of the app.',
  ]);
});

test('no database, a database without the table, a body with control characters: nothing breaks, nothing unsafe is printed', async () => {
  assert.deepEqual(await openAlerts({ dbPath: join(tmpdir(), 'jht-no-such-dir', 'jobs.db') }), []);
  const empty = mkdtempSync(join(tmpdir(), 'jht-alerts-empty-'));
  new DatabaseSync(join(empty, 'jobs.db')).close();
  assert.deepEqual(await openAlerts({ dbPath: join(empty, 'jobs.db') }), []);
  const [alert] = await openAlerts({ dbPath: join(home([{ body: 'top it up\x1b[2J now‮' }]), 'jobs.db') });
  assert.equal(alert.body, 'top it up[2J now');
});

test('jht team status says the open alert of the Capitano, and does not mark it as read', () => {
  const root = home([{ body: CEILING, source: 'no-quota-mode-x' }]);
  const r = spawnSync(process.execPath, [JHT, 'team', 'status'], { encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, JHT_HOME: root, JHT_LANG: 'en', NO_COLOR: '1' } });
  assert.match(r.stdout + r.stderr, /Capitano says: No spending ceiling is set for this key/);
  const db = new DatabaseSync(join(root, 'jobs.db'));
  assert.equal(db.prepare('SELECT acknowledged_at FROM pending_user_messages').get().acknowledged_at, null);
  db.close();
});

test('the agent of a row is a plain name too: escape sequences, bidi marks and long text in it are not printed', async () => {
  const { safeAgent, agentLabel } = await import('../src/lib/open-alerts.js');
  assert.equal(safeAgent('capitano'), 'capitano');
  assert.equal(safeAgent('Scout-2'), 'scout-2');
  for (const bad of ['cap\x1b[2Jitano', 'capi‮tano', 'cap itano', 'capi\ntano', '', null, 'a'.repeat(41), '-capitano']) assert.equal(safeAgent(bad), '', JSON.stringify(bad));
  const root = home([{ agent: 'capi\x1b]0;owned\x07tano‮', body: CEILING }]);
  const [alert] = await openAlerts({ dbPath: join(root, 'jobs.db') });
  assert.equal(alert.agent, '');
  const [line] = await openAlertLines({ dbPath: join(root, 'jobs.db') });
  assert.equal(line, `? says: ${CEILING}`);
  assert.doesNotMatch(line, /[\x00-\x1f\x7f-\x9f‮]/);
  assert.equal(agentLabel(''), '?');
});
