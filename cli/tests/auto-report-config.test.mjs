import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));
test('config accepts live panorama preferences and refuses invalid values without changing the file', () => {
  const home = mkdtempSync(join(tmpdir(), 'jht-panorama-'));
  try {
    const file = join(home, 'jht.config.json');
    writeFileSync(file, JSON.stringify({ language: 'en', team: { keep: 'unchanged' } }));
    const run = (...args) => spawnSync(process.execPath, [entry, 'config', ...(args[0] === 'set' ? ['set', '--', ...args.slice(1)] : args)], {
      env: { ...process.env, JHT_HOME: home, JHT_LANG: 'en' }, encoding: 'utf8', timeout: 15000,
    });
    for (const [key, value] of [['enabled', 'false'], ['interval_min', '5'], ['interval_min', '10080'], ['enabled', 'true']]) {
      const r = run('set', `team.auto_report.${key}`, value);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(readFileSync(file)).team.auto_report[key], JSON.parse(value));
    }
    for (const value of ['text', '0', '-1', '4', '5.5', 'true', '10081', '"120"', 'null']) {
      const before = readFileSync(file, 'utf8');
      const r = run('set', 'team.auto_report.interval_min', value);
      assert.equal(r.status, 1, value);
      assert.match(r.stderr, /5.*10080/);
      assert.equal(readFileSync(file, 'utf8'), before);
    }
    for (const [key, value] of [['enabled', 'no'], ['enabled', '0'], ['other', 'true']]) {
      const before = readFileSync(file, 'utf8');
      assert.equal(run('set', `team.auto_report.${key}`, value).status, 1);
      assert.equal(readFileSync(file, 'utf8'), before);
    }
    assert.equal(run('set', 'team.auto_report', '{"enabled":false,"interval_min":30}').status, 0);
    assert.deepEqual(JSON.parse(run('get', 'team.auto_report').stdout), { enabled: false, interval_min: 30 });
    assert.equal(JSON.parse(readFileSync(file)).team.keep, 'unchanged');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
