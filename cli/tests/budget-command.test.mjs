// `jht budget` (JHT-T345): see, set and remove the team's budget after the setup, with the same fields the setup writes and the
// brake reads (team.budget, no_quota_cap.usd, team.working_hours). Pure functions with a fixed clock, then the real command in a
// box with a synthetic configuration; nothing reaches a provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyClear, applySet, budgetState } from '../src/commands/budget.js';

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'jht.js');
const NOW = new Date('2026-11-15T21:30:00Z');
const BASE = { version: 1, active_provider: 'glm', providers: { glm: { auth_method: 'api_key' } } };

test('3 $ for 15 minutes: a new budget of a duration, its period from the first work of the team', () => {
  const r = applySet(BASE, { usd: '3', minutes: '15' }, { now: NOW, timeZone: 'Europe/Rome' });
  assert.equal(r.newBudget, true);
  assert.deepEqual(r.config.team.budget, { usd: 3, duration_minutes: 15, saved_at: NOW.toISOString(), timezone: 'Europe/Rome', set_by: 'jht budget' });
  assert.deepEqual(r.config.providers, BASE.providers, 'nothing else of the config changes');
  assert.equal(applySet(BASE, { usd: '10', until: '18:30' }, { now: NOW, timeZone: 'Europe/Rome' }).config.team.budget.ends_at, '2026-11-16T17:30:00.000Z');
  assert.equal(applySet(BASE, { usd: '10', hours: '2' }, { now: NOW, timeZone: 'UTC' }).config.team.budget.duration_minutes, 120);
});

test('the ceiling per day is no_quota_cap.usd, the one the brake applies; none removes it and keeps the other keys', () => {
  const old = { ...BASE, no_quota_cap: { eur: 10, tokens_per_hour: 500000 } };
  const r = applySet(old, { dailyUsd: '5' }, { now: NOW });
  assert.deepEqual(r.config.no_quota_cap, { usd: 5, tokens_per_hour: 500000 }, 'usd replaces the older eur');
  assert.equal(r.newBudget, false);
  assert.deepEqual(applySet(r.config, { dailyUsd: 'none' }, { now: NOW }).config.no_quota_cap, { tokens_per_hour: 500000 });
  assert.equal('no_quota_cap' in applySet({ ...BASE, no_quota_cap: { usd: 3 } }, { dailyUsd: 'none' }, { now: NOW }).config, false);
  assert.ok(applySet(BASE, { dailyUsd: 'lots' }, { now: NOW }).error);
});

test('working hours of the person\'s choice, or always; days without a time are refused', () => {
  const r = applySet(BASE, { workDays: 'mon-fri', workTime: '09:00-18:00' }, { now: NOW, timeZone: 'Europe/Rome' });
  assert.deepEqual(r.config.team.working_hours, { timezone: 'Europe/Rome', windows: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '18:00' }] });
  assert.equal('team' in applySet(r.config, { always: true }, { now: NOW }).config, false);
  assert.ok(applySet(BASE, { workDays: 'mon-fri' }, { now: NOW }).error);
  assert.ok(applySet(BASE, { workDays: 'mon-fri', workTime: '9-18' }, { now: NOW }).error);
});

test('the pace turns on and off on the budget there is, without starting it again', () => {
  const set = applySet(BASE, { usd: '10', days: '3' }, { now: NOW, timeZone: 'UTC' }).config;
  const on = applySet(set, { pace: 'on' }, { now: new Date(NOW.getTime() + 3600_000) }).config;
  assert.deepEqual(on.team.budget, { ...set.team.budget, pace: true }, 'same saved_at: the period goes on');
  assert.equal('pace' in applySet(on, { pace: 'off' }, { now: NOW }).config.team.budget, false);
  assert.ok(applySet(BASE, { pace: 'on' }, { now: NOW }).error, 'no budget to spread');
  assert.ok(applySet(set, { pace: 'maybe' }, { now: NOW }).error);
});

test('nothing given, a wrong amount or two periods: an error and no change', () => {
  assert.ok(applySet(BASE, {}, { now: NOW }).error);
  assert.ok(applySet(BASE, { usd: '0', minutes: '15' }, { now: NOW }).error);
  assert.ok(applySet(BASE, { usd: '3', minutes: '15', days: '1' }, { now: NOW }).error);
  assert.ok(applySet(BASE, { minutes: '15' }, { now: NOW }).error);
});

test('clear removes the budget and the ceiling per day, and keeps the working hours', () => {
  const full = { ...BASE, no_quota_cap: { usd: 5 }, team: { budget: { usd: 3, duration_minutes: 15, saved_at: NOW.toISOString() }, working_hours: { timezone: 'UTC', windows: [{ days: ['mon'], start: '09:00', end: '18:00' }] } } };
  const cleared = applyClear(full);
  assert.deepEqual(cleared.team, { working_hours: full.team.working_hours });
  assert.equal('no_quota_cap' in cleared, false);
});

test('the state reads the start the brake recorded for this budget, and not one of another budget', () => {
  const config = { ...BASE, team: { budget: { usd: 3, duration_minutes: 15, saved_at: 'S1', timezone: 'UTC' } } };
  const start = { saved_at: 'S1', starts_at: '2026-11-15T22:00:00+00:00', ends_at: '2026-11-15T22:15:00+00:00' };
  assert.equal(budgetState(config, start).budget.ends_at, start.ends_at);
  assert.equal(budgetState(config, { ...start, saved_at: 'OLD' }).budget.starts_at, null);
  assert.deepEqual(budgetState({ ...BASE, no_quota_cap: { eur: 10, eur_to_usd: 1.1 } }, null).daily, { usd: 11, declared: 10, currency: 'EUR' });
});

function box() {
  const root = mkdtempSync(join(tmpdir(), 'jht-budget-'));
  const home = join(root, '.jht');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify(BASE));
  return { root, home };
}

function jht(b, args, lang = 'en') {
  const r = spawnSync(process.execPath, [entry, 'budget', ...args], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: b.root, JHT_HOME: b.home, JHT_LANG: lang, TZ: 'Europe/Rome' },
    encoding: 'utf8', timeout: 30_000,
  });
  return { out: `${r.stdout}${r.stderr}`, status: r.status };
}

test('the command: set, show in the language of the person, --json, clear; a wrong option changes nothing', () => {
  const b = box();
  const set = jht(b, ['set', '--usd', '3', '--minutes', '15', '--daily-usd', '2'], 'it');
  assert.equal(set.status, 0, set.out);
  assert.match(set.out, /Budget: 3 \$ in tutto/);
  assert.match(set.out, /Periodo: 15 minuti dal primo lavoro della squadra/);
  assert.match(set.out, /jht budget, oppure jht team status/);
  const saved = JSON.parse(readFileSync(join(b.home, 'jht.config.json'), 'utf8'));
  assert.deepEqual([saved.team.budget.usd, saved.team.budget.duration_minutes, saved.no_quota_cap.usd], [3, 15, 2]);
  const json = JSON.parse(jht(b, ['--json']).out);
  assert.deepEqual([json.budget.usd, json.budget.starts_at, json.daily.usd, json.working_hours], [3, null, 2, null]);
  const before = readFileSync(join(b.home, 'jht.config.json'), 'utf8');
  const bad = jht(b, ['set', '--work-days', 'mon-fri']);
  assert.equal(bad.status, 1);
  assert.equal(readFileSync(join(b.home, 'jht.config.json'), 'utf8'), before, 'a refused change writes nothing');
  assert.equal(jht(b, ['clear']).status, 0);
  assert.match(jht(b, []).out, /^No budget/);
});

test('with no configuration the command says to run the setup', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-budget-none-'));
  const r = jht({ root, home: join(root, '.jht') }, []);
  assert.equal(r.status, 1);
  assert.match(r.out, /jht setup/);
});
