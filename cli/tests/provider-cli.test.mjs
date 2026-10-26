import assert from 'node:assert/strict';
import test from 'node:test';
import { cliAvailable, providerCli } from '../src/commands/team/agents.js';

test('the CLI that drives the agents is the active provider\'s, by name or alias', () => {
  assert.equal(providerCli({ active_provider: 'openai' }), 'codex');
  assert.equal(providerCli({ active_provider: 'Codex' }), 'codex');
  assert.equal(providerCli({ active_provider: ' claude ' }), 'claude');
  assert.equal(providerCli({ active_provider: 'anthropic' }), 'claude');
  assert.equal(providerCli({ active_provider: 'moonshot' }), 'kimi');
});

test('no provider chosen is no CLI: claude is never the answer by default', () => {
  for (const config of [null, undefined, {}, { active_provider: '' }, { active_provider: '  ' }, { active_provider: 7 }, { active_provider: 'unknown' }]) {
    assert.equal(providerCli(config), null, JSON.stringify(config));
  }
});

test('only a plain CLI name is looked up in the PATH', () => {
  assert.equal(cliAvailable('node; echo x'), false);
  assert.equal(cliAvailable('node'), true);
  assert.equal(cliAvailable('jht-no-such-cli'), false);
});

test('the config team start reads is a regular file: a link or a pipe in its place is refused, not opened', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readRegularFileText } = await import('../src/lib/secure-config-io.js');
  const dir = mkdtempSync(join(tmpdir(), 'jht-cfg-'));
  const file = join(dir, 'jht.config.json');
  writeFileSync(file, '{"active_provider":"openai"}');
  assert.equal(readRegularFileText(file), '{"active_provider":"openai"}');
  const link = join(dir, 'link.json');
  symlinkSync(file, link);
  assert.throws(() => readRegularFileText(link), { code: 'ELOOP' });
  if (process.platform !== 'win32') {
    const fifo = join(dir, 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    assert.throws(() => readRegularFileText(fifo), { code: 'EINVAL' });
  }
  assert.throws(() => readRegularFileText(join(dir, 'missing.json')), { code: 'ENOENT' });
});

// team start reads the config in a child with a deadline: a read that opens a pipe never returns.
test('team start\'s own read of the config refuses a pipe and a link in place of the file', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, symlinkSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const start = resolve(import.meta.dirname, '../src/commands/team/start.js');
  const dir = mkdtempSync(join(tmpdir(), 'jht-start-cfg-'));
  const read = (path) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(start)}); console.log(JSON.stringify(m.readJhtConfig(${JSON.stringify(path)})));`,
  ], { encoding: 'utf8', timeout: 8000, env: { ...process.env, JHT_HOME: dir } }));
  const file = join(dir, 'jht.config.json');
  writeFileSync(file, '{"active_provider":"openai"}');
  assert.deepEqual(read(file), { active_provider: 'openai' });
  const link = join(dir, 'link.json');
  symlinkSync(file, link);
  assert.equal(read(link), null);
  assert.equal(read(join(dir, 'missing.json')), null);
  if (process.platform !== 'win32') {
    const fifo = join(dir, 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    assert.equal(read(fifo), null);
  }
});
