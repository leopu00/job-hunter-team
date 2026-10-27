import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const REGISTRY = resolve(import.meta.dirname, '../../shared/skills/plan_registry.py');
const hasPython = spawnSync('python3', ['-c', 'import sys']).status === 0;

// The command alone, as the CLI registers it, in a home of its own.
const RUNNER = `
import { Command } from 'commander';
import { registerProvidersCommand } from ${JSON.stringify(resolve(import.meta.dirname, '../src/commands/providers.js'))};
const program = new Command();
registerProvidersCommand(program);
await program.parseAsync(process.argv.slice(1), { from: 'user' });
`;

function home(config) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-plan-'));
  if (config !== undefined) writeFileSync(join(dir, 'jht.config.json'), typeof config === 'string' ? config : JSON.stringify(config, null, 2));
  return dir;
}

function plan(dir, ...args) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER, 'providers', 'plan', ...args], {
    encoding: 'utf8', timeout: 60000, cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, JHT_HOME: dir, JHT_LANG: 'en', NO_COLOR: '1' },
  });
}

const read = (dir) => JSON.parse(readFileSync(join(dir, 'jht.config.json'), 'utf8'));
const registry = (dir, ...args) => spawnSync('python3', ['-I', REGISTRY, ...args], {
  encoding: 'utf8', env: { ...process.env, JHT_HOME: dir, PYTHONDONTWRITEBYTECODE: '1' },
});

test('without an active provider the command says which command chooses one, and writes nothing', { skip: !hasPython }, () => {
  for (const config of [undefined, {}, { active_provider: '' }]) {
    const dir = home(config);
    const done = plan(dir, 'plus');
    assert.equal(done.status, 1);
    assert.match(done.stderr, /no active provider.*jht providers use openai/);
  }
});

test('without an id it shows the plan now and the possible ones', { skip: !hasPython }, () => {
  const none = home({ active_provider: 'openai' });
  const before = plan(none);
  assert.equal(before.status, 0, before.stderr);
  assert.match(before.stdout, /no plan declared/);
  assert.match(before.stdout, /plus\b.*Plus/);
  assert.match(before.stdout, /pro-max\b/);
  assert.match(before.stdout, /jht providers plan <id>/);

  const declared = home({ active_provider: 'openai', providers: { openai: { plan: 'pro' } } });
  const after = plan(declared);
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /plan: Pro \(pro\), provider openai/);
});

test('an id is declared where the wizard declares it, with the rest of the configuration kept and private', { skip: !hasPython }, () => {
  const config = { active_provider: 'openai', providers: { openai: { auth_method: 'subscription', model: 'm' }, kimi: { plan: 'allegretto' } }, other: { keep: [1, 2] } };
  const dir = home(config);
  const done = plan(dir, ' PLUS ');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /plan: Plus \(plus\), provider openai/);
  const written = read(dir);
  assert.deepEqual(written, { ...config, providers: { ...config.providers, openai: { ...config.providers.openai, plan: 'plus' } } });
  assert.equal(lstatSync(join(dir, 'jht.config.json')).mode & 0o777, 0o600);
  // the registry the Capitano's first run reads agrees
  assert.equal(JSON.parse(registry(dir, 'get').stdout).id, 'plus');

  // and it is the very same file the wizard's own command leaves
  const wizard = home(config);
  assert.equal(registry(wizard, 'set', 'openai:plus').status, 0);
  assert.deepEqual(read(wizard), written);
});

test('an alias of the active provider declares under the provider\'s own name', { skip: !hasPython }, () => {
  const dir = home({ active_provider: 'codex' });
  const done = plan(dir, 'pro');
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(read(dir), { active_provider: 'codex', providers: { openai: { plan: 'pro' } } });
  assert.equal(JSON.parse(registry(dir, 'get').stdout).id, 'pro');
});

test('an id that is not a plan of the provider is refused and the file is left as it was', { skip: !hasPython }, () => {
  const text = JSON.stringify({ active_provider: 'openai', providers: { openai: {} } }, null, 4);
  const dir = home(text);
  for (const id of ['gold', 'openai:plus', '', 'plus; rm']) {
    const done = plan(dir, id);
    assert.equal(done.status, 1, id);
    assert.match(done.stderr, /is not one of the openai plans/);
    assert.equal(readFileSync(join(dir, 'jht.config.json'), 'utf8'), text);
  }
});

test('a configuration that is there and cannot be read stops the command: nothing is written, nothing is advised', { skip: !hasPython }, () => {
  const broken = home('{ not json');
  const link = home();
  const real = join(link, 'real.json');
  writeFileSync(real, JSON.stringify({ active_provider: 'openai' }));
  symlinkSync(real, join(link, 'jht.config.json'));
  const array = home('[]');
  for (const [dir, before] of [[broken, '{ not json'], [array, '[]']]) {
    for (const args of [[], ['plus']]) {
      const done = plan(dir, ...args);
      assert.equal(done.status, 1);
      assert.match(done.stderr, /cannot be read/);
      assert.ok(!/jht providers use/.test(done.stderr), 'no advice to start over');
      assert.equal(readFileSync(join(dir, 'jht.config.json'), 'utf8'), before);
    }
  }
  const done = plan(link, 'plus');
  assert.equal(done.status, 1);
  assert.match(done.stderr, /cannot be read/);
  assert.equal(lstatSync(join(link, 'jht.config.json')).isSymbolicLink(), true);
  assert.equal(readFileSync(real, 'utf8'), JSON.stringify({ active_provider: 'openai' }));
});
