// `jht setup --non-interactive` with --budget-usd and one of --budget-minutes, --budget-days, --budget-until, or --no-budget (JHT-T322):
// what lands under team.budget of the config, the refusals of wrong values (nothing saved), and no option = the setup of before.
// Made-up homes and keys; the clock is fixed with `now`.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

process.env.TZ = 'Europe/Rome';
const HOME = mkdtempSync(join(tmpdir(), 'jht-budget-ni-'));
const DEPS = join(HOME, 'deps');
process.env.JHT_HOME = join(HOME, 'home');
process.env.JHT_DEPS_PREFIX = DEPS;
mkdirSync(process.env.JHT_HOME);
const { runNonInteractiveSetup } = await import('../wizard/setup-noninteractive.js');
const { registerSetupCommand } = await import('../src/commands/setup.js');
const { Command } = await import('commander');

const KEY = ['synthetic', 'value', 'cd'.repeat(10)].join('-');
const CONFIG = join(process.env.JHT_HOME, 'jht.config.json');
// Sunday 15/11/2026 22:30 in Rome (21:30 UTC)
const NOW = new Date('2026-11-15T21:30:00.000Z');
const MINUTE = 60_000;

async function setup(opts) {
  const out = [];
  const log = console.log; const error = console.error; const realFetch = globalThis.fetch;
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  globalThis.fetch = async () => ({ status: 200, ok: true });
  process.exitCode = 0;
  try {
    await runNonInteractiveSetup({
      language: 'en', authMethod: 'api_key', harness: 'pi', provider: 'claude', apiKeyStdin: true,
      stdin: Readable.from([Buffer.from(`${KEY}\n`)]), now: NOW, ...opts,
    });
  } finally { console.log = log; console.error = error; globalThis.fetch = realFetch; }
  const code = process.exitCode; process.exitCode = 0;
  return { code, text: out.join('\n') };
}
const read = () => JSON.parse(readFileSync(CONFIG, 'utf8'));
const fresh = () => { rmSync(CONFIG, { force: true }); rmSync(join(DEPS, 'keys'), { recursive: true, force: true }); };
/** The options as Commander gives them for these words of the command line. */
function parsed(...words) {
  let got;
  const program = new Command().exitOverride();
  registerSetupCommand(program);
  program.commands[0].action((opts) => { got = opts; });
  program.parse(['node', 'jht', 'setup', ...words]);
  return got;
}

test('$5 for 30 minutes: a duration of 30 minutes that starts when the team starts working, the dollars counted from the setup', async () => {
  fresh();
  const { code, text } = await setup({ budgetUsd: '5', budgetMinutes: '30' });
  assert.equal(code, 0, text);
  assert.deepEqual(read().team.budget, {
    usd: 5, duration_minutes: 30, saved_at: NOW.toISOString(), timezone: 'Europe/Rome', set_by: 'setup',
  });
  assert.match(text, /Budget: /);
});

test('until 8: the period ends at the next 08:00 of the local zone (tomorrow morning)', async () => {
  fresh();
  const { code, text } = await setup({ budgetUsd: '5', budgetUntil: '8' });
  assert.equal(code, 0, text);
  const { budget } = read().team;
  assert.equal(budget.usd, 5);
  assert.equal(budget.starts_at, NOW.toISOString());
  assert.equal(budget.ends_at, '2026-11-16T07:00:00.000Z', '08:00 in Rome on Monday');
});

test('$10 for 3 days', async () => {
  fresh();
  const { code, text } = await setup({ budgetUsd: '10', budgetDays: '3' });
  assert.equal(code, 0, text);
  const { budget } = read().team;
  assert.equal(budget.usd, 10);
  assert.deepEqual([budget.duration_minutes, budget.saved_at, budget.ends_at], [3 * 24 * 60, NOW.toISOString(), undefined]);
});

test('--no-budget: no team.budget, and a budget saved before is removed (the other team fields stay)', async () => {
  fresh();
  assert.equal((await setup({ budgetUsd: '10', budgetDays: '3' })).code, 0);
  const config = read();
  config.team.working_hours = { timezone: 'Europe/Rome', windows: [{ days: ['mon'], start: '09:00', end: '18:00' }] };
  writeFileSync(CONFIG, JSON.stringify(config));
  const { code, text } = await setup({ budget: false });
  assert.equal(code, 0, text);
  const saved = read();
  assert.equal(saved.team.budget, undefined);
  assert.deepEqual(saved.team.working_hours, config.team.working_hours);
  fresh();
  assert.equal((await setup({ budget: false })).code, 0);
  assert.equal(read().team, undefined, 'no empty team object on a new config');
});

test('wrong values are refused with a clear sentence, before any key is kept, and nothing is saved', async () => {
  const cases = [
    [{ budgetUsd: 'ten', budgetDays: '3' }, /--budget-usd must be a positive amount/],
    [{ budgetUsd: '0', budgetDays: '3' }, /--budget-usd must be a positive amount/],
    [{ budgetUsd: '-5', budgetMinutes: '30' }, /--budget-usd must be a positive amount/],
    [{ budgetUsd: '5' }, /Give the period with one of --budget-minutes/],
    [{ budgetUsd: '5', budgetMinutes: '30', budgetDays: '3' }, /Give the period with one of/],
    [{ budgetDays: '3' }, /Give the amount with --budget-usd/],
    [{ budgetUsd: '5', budgetMinutes: '0' }, /--budget-minutes must be a positive number/],
    [{ budgetUsd: '5', budgetDays: 'abc' }, /--budget-days must be a positive number/],
    [{ budgetUsd: '5', budgetUntil: '24' }, /--budget-until is a whole hour of the day, 0 to 23/],
    [{ budgetUsd: '5', budgetUntil: '08:30' }, /--budget-until is a whole hour of the day/],
  ];
  for (const [opts, message] of cases) {
    fresh();
    const { code, text } = await setup(opts);
    assert.equal(code, 1, `${JSON.stringify(opts)} → ${text}`);
    assert.match(text, message, JSON.stringify(opts));
    assert.equal(existsSync(CONFIG), false, `nothing saved for ${JSON.stringify(opts)}`);
    assert.equal(existsSync(join(DEPS, 'keys', 'claude.key')), false, `no key kept for ${JSON.stringify(opts)}`);
  }
});

test('no budget option: the setup of before (no team.budget on a new config, a budget saved before is kept, no Budget line)', async () => {
  fresh();
  const { code, text } = await setup({});
  assert.equal(code, 0, text);
  assert.equal(read().team, undefined);
  assert.doesNotMatch(text, /Budget: /);
  assert.equal((await setup({ budgetUsd: '5', budgetMinutes: '30' })).code, 0);
  const before = read().team.budget;
  assert.equal((await setup({ budget: true })).code, 0, 'what Commander gives without --no-budget');
  assert.deepEqual(read().team.budget, before);
});

test('the command line: the five options reach the setup as budgetFromOptions reads them', () => {
  assert.deepEqual(
    (({ budgetUsd, budgetMinutes, budgetDays, budgetUntil, budget }) => ({ budgetUsd, budgetMinutes, budgetDays, budgetUntil, budget }))(
      parsed('--non-interactive', '--budget-usd', '10', '--budget-days', '3')),
    { budgetUsd: '10', budgetMinutes: undefined, budgetDays: '3', budgetUntil: undefined, budget: true },
  );
  assert.equal(parsed('--budget-usd', '5', '--budget-minutes', '30').budgetMinutes, '30');
  assert.equal(parsed('--budget-usd', '5', '--budget-until', '8').budgetUntil, '8');
  assert.equal(parsed('--budget-usd', '5', '--budget-until', '08:00').budgetUntil, '08:00');
  assert.equal(parsed('--no-budget').budget, false);
  const help = new Command(); registerSetupCommand(help);
  const text = help.commands[0].helpInformation();
  for (const flag of ['--budget-usd <dollars>', '--budget-minutes <n>', '--budget-days <n>', '--budget-until <hour>', '--no-budget']) {
    assert.ok(text.includes(flag), `${flag} in the help`);
  }
  assert.ok(!text.includes('wizard.cli.budget'), 'the help has the sentences, not the keys of the catalog');
  assert.ok(!text.includes('wizard.cli.no_budget'));
});

test('a setup made again with the same duration budget (also with --reset) opens a new period, so a spent or ended one is never a dead end', async () => {
  fresh();
  assert.equal((await setup({ budgetUsd: '5', budgetMinutes: '30' })).code, 0);
  const first = read().team.budget;
  const later = new Date(NOW.getTime() + 2 * 3600_000);
  assert.equal((await setup({ budgetUsd: '5', budgetMinutes: '30', reset: true, now: later })).code, 0);
  assert.equal(read().team.budget.saved_at, later.toISOString(), 'the same answers are a new period, from now');
  assert.equal(read().team.budget.usd, first.usd);
  assert.equal((await setup({ budgetUsd: '10', budgetMinutes: '30', now: later })).code, 0);
  assert.equal(read().team.budget.saved_at, later.toISOString(), 'a new amount is a new budget, from now');
});
