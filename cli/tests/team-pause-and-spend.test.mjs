// JHT-T349/T354: `jht team status` says the one pause that holds the team (the spending brake, the person's pause, the standby) and
// the figure the brake measured at its last look, never the first one told. Synthetic flags and figures in made-up homes.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.JHT_LANG = 'en';
const { teamPause, teamPauseText, standbyPause, spendNowText } = await import('../src/lib/budget-pause.js');
const { show } = await import('../src/lib/texts.js');

const NOW = new Date('2026-11-27T12:00:00Z');
function home({ brake, standby, spend } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-team-pause-'));
  mkdirSync(join(root, 'logs'));
  mkdirSync(join(root, 'state'));
  if (brake) writeFileSync(join(root, 'logs', 'daily-halt.flag'), JSON.stringify(brake));
  if (standby !== undefined) writeFileSync(join(root, '.team-standby.flag'), typeof standby === 'string' ? standby : JSON.stringify(standby));
  if (spend) writeFileSync(join(root, 'state', 'spend-now.json'), JSON.stringify(spend));
  return root;
}
const USER = { since: 1764240000, until: '2026-12-04T11:00:00+00:00', wake_on: null, reason: 'user pause', requested_by: 'assistente', mode: 'pause', manual: true };
const BRAKE = { reason: 'pi_spend_cap', pi_spend_cap: { why: 'budget', spent: 2.87, ceiling: 3, budget_usd: 3 } };

test('the person\'s pause is a pause of the team, in the text and in the object', () => {
  const root = home({ standby: USER });
  assert.deepEqual(teamPause({ home: root, now: NOW }), { kind: 'user', since: 1764240000, until: USER.until, byUser: true });
  assert.match(show(teamPauseText({ home: root, now: NOW })), /^The team is paused \(you asked for it\)/);
});

test('the spending brake comes first, whatever the standby says', () => {
  const pause = teamPause({ home: home({ brake: BRAKE, standby: USER }), now: NOW });
  assert.equal(pause.kind, 'budget');
  assert.equal(pause.why, 'budget');
});

test('the stop the Capitano committed to is said as such', () => {
  const root = home({ brake: { reason: 'pi_spend_cap', pi_spend_cap: { why: 'stop_at', spent: 2.41, ceiling: 2.4 } } });
  assert.equal(show(teamPauseText({ home: root, now: NOW })),
    'The team is paused: it spent $2.41, the stop the Captain committed to ($2.40). To go on, tell the Captain.');
});

test('a standby flag that is expired, broken or without an exit holds nothing', () => {
  for (const flag of [{ ...USER, until: '2026-11-27T11:00:00+00:00' }, '{broken', '[]', { since: 1, until: null, wake_on: null }]) {
    assert.equal(standbyPause({ home: home({ standby: flag }), now: NOW }), null, JSON.stringify(flag));
  }
  assert.equal(teamPause({ home: home(), now: NOW }), null);
  assert.equal(standbyPause({ home: home({ standby: { since: 1, until: null, wake_on: { weekly_below: 100 } } }), now: NOW }).kind, 'standby');
});

test('the spending line is the last figure the brake measured, with its rate; a day-old file says nothing', () => {
  const at = Math.floor(NOW.getTime() / 1000) - 60;
  const today = spendNowText({ home: home({ spend: { at, spent_usd: 3.45, counts: 'today', usd_per_min: 0.15, window_min: 10 } }), now: NOW });
  assert.match(show(today), /^Spent today: \$3\.45 · \$0\.150 a minute over the last 10 min \(updated at /);
  const budget = spendNowText({ home: home({ spend: { at, spent_usd: 2.87, counts: 'budget', budget_usd: 3, usd_per_min: 0.2, window_min: 10 } }), now: NOW });
  assert.match(show(budget), /^Spent of the budget: \$2\.87 of \$3\.00/);
  assert.equal(spendNowText({ home: home({ spend: { at: at - 2 * 86400, spent_usd: 1, usd_per_min: 0 } }), now: NOW }), null);
  assert.equal(spendNowText({ home: home(), now: NOW }), null);
});
