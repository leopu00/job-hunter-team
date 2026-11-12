// The services of this release are ONE list (shared/runtime/release-providers.js). Bringing one back is that line and this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_PROVIDERS, RELEASE_HARNESS, offeredInRelease } from '../../shared/runtime/release-providers.js';
import { WIZARD_PROVIDERS } from '../wizard/setup.js';

const cli = fileURLToPath(new URL('..', import.meta.url));

test('this release offers GLM only, on Pi; the wizard offers exactly the list', () => {
  assert.deepEqual([...RELEASE_PROVIDERS], ['glm']);
  assert.equal(RELEASE_HARNESS, 'pi');
  assert.deepEqual(WIZARD_PROVIDERS.map((p) => p.value), [...RELEASE_PROVIDERS]);
  for (const name of ['openai', 'codex', 'claude', 'anthropic', 'kimi', 'moonshot', '', null, 'gemini']) assert.equal(offeredInRelease(name), false, String(name));
  assert.equal(offeredInRelease(' GLM '), true);
});

test('jht doctor calls a team on a service this release does not offer not supported, says what to do, and does not touch it', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-release-'));
  const home = join(root, '.jht');
  mkdirSync(home, { recursive: true });
  const config = JSON.stringify({ version: 4, active_provider: 'openai', harness: 'codex', providers: { openai: { name: 'openai', auth_method: 'subscription', model: 'm' } }, channels: {} });
  writeFileSync(join(home, 'jht.config.json'), config);
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, JHT_HOME: home, LANG: 'en_US.UTF-8', NO_COLOR: '1', JHT_LANG: 'en' };
  const done = spawnSync(process.execPath, [join(cli, 'bin/jht.js'), 'doctor', '--all'], { env, encoding: 'utf8', timeout: 60_000 });
  const said = (done.stdout + done.stderr).replace(/\s+/g, ' ');
  assert.match(said, /Provider openai is not supported in this release \(offered: glm, on Pi with an API key\)/, said);
  assert.match(said, /jht setup \(choose glm and paste its API key/, said);
});
