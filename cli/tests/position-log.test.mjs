import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const module = new URL('../src/lib/position-show.js', import.meta.url).href;

function fixture(context) {
  const home = mkdtempSync(join(tmpdir(), 'jht-position-log-'));
  context.after(() => rmSync(home, { recursive: true }));
  return { home, dir: join(home, 'logs'), log: join(home, 'logs/runtime.log') };
}

function invalidRead(home, view = 'position') {
  const call = view === 'dashboard' ? 'showHumanDashboard({}, read)' : 'showHumanPosition(1, {}, read)';
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { showHumanPosition, showHumanDashboard } from ${JSON.stringify(module)};
     const read = () => ({ code: 0, stdout: 'not json', stderr: '' });
     process.exitCode = ${call};`], {
    encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL',
    env: { ...process.env, JHT_HOME: home, JHT_LANG: 'en' },
  });
}

function refused(result) {
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /position_read_invalid/);
  assert.match(result.stderr, /position_log_unavailable/);
}

test('a normal diagnostic file is created and both views preserve exit 2 and visible errors', (context) => {
  const { home, log } = fixture(context);
  for (const view of ['position', 'dashboard']) {
    const result = invalidRead(home, view);
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`${view}_read_invalid`));
    assert.doesNotMatch(result.stderr, /position_log_unavailable/);
    assert.match(readFileSync(log, 'utf8'), new RegExp(`${view}_read_invalid`));
  }
  if (process.platform !== 'win32') assert.equal(lstatSync(log).mode & 0o777, 0o600);
});

test('an existing regular log is appended and its old broad permissions are tightened', (context) => {
  const { home, dir, log } = fixture(context);
  mkdirSync(dir);
  writeFileSync(log, 'synthetic sentinel\n');
  chmodSync(log, 0o666);
  const result = invalidRead(home);
  assert.equal(result.status, 2, result.stderr);
  assert.doesNotMatch(result.stderr, /position_log_unavailable/);
  assert.match(readFileSync(log, 'utf8'), /^synthetic sentinel\n.*position_read_invalid:/);
  if (process.platform !== 'win32') assert.equal(lstatSync(log).mode & 0o777, 0o600);
});

test('a runtime.log symlink leaves the target bytes and permissions intact', (context) => {
  const { home, dir, log } = fixture(context);
  mkdirSync(dir);
  const target = join(home, 'synthetic-target');
  writeFileSync(target, 'synthetic sentinel');
  const before = lstatSync(target).mode;
  symlinkSync(target, log);
  refused(invalidRead(home));
  assert.equal(readFileSync(target, 'utf8'), 'synthetic sentinel');
  assert.equal(lstatSync(target).mode, before);
});

test('a hardlinked runtime.log leaves the target bytes and permissions intact', (context) => {
  const { home, dir, log } = fixture(context);
  mkdirSync(dir);
  const target = join(home, 'synthetic-target');
  writeFileSync(target, 'synthetic sentinel');
  const before = lstatSync(target).mode;
  linkSync(target, log);
  refused(invalidRead(home));
  assert.equal(readFileSync(target, 'utf8'), 'synthetic sentinel');
  assert.equal(lstatSync(target).mode, before);
});

test('a linked logs directory cannot redirect a diagnostic write', (context) => {
  const { home, dir } = fixture(context);
  const target = join(home, 'synthetic-directory');
  mkdirSync(target);
  const targetLog = join(target, 'runtime.log');
  writeFileSync(targetLog, 'synthetic sentinel');
  symlinkSync(target, dir, 'dir');
  refused(invalidRead(home));
  assert.equal(readFileSync(targetLog, 'utf8'), 'synthetic sentinel');
});

test('a special file is rejected without hanging or replacing it', (context) => {
  const { home, dir, log } = fixture(context);
  mkdirSync(dir);
  if (process.platform === 'win32') mkdirSync(log);
  else {
    const made = spawnSync('mkfifo', [log], { encoding: 'utf8', timeout: 3000 });
    assert.equal(made.status, 0, made.stderr);
    assert.equal(lstatSync(log).isFIFO(), true);
  }
  refused(invalidRead(home));
  assert.equal(process.platform === 'win32' ? lstatSync(log).isDirectory() : lstatSync(log).isFIFO(), true);
});
