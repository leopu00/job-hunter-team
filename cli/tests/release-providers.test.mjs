// The services of this release are ONE list (shared/runtime/release-providers.js). Bringing one back is that line and this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('jht providers lists the services of the release first, and a provider it does not offer only to the team on it, saying so', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-release-list-'));
  const home = join(root, '.jht');
  mkdirSync(home, { recursive: true });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, JHT_HOME: home, LANG: 'en_US.UTF-8', NO_COLOR: '1', JHT_LANG: 'en' };
  const list = () => spawnSync(process.execPath, [join(cli, 'bin/jht.js'), 'providers'], { env, encoding: 'utf8', timeout: 60_000 }).stdout;
  const fresh = list();
  assert.match(fresh, /GLM \(Z\.ai\) · offered in this release \(Pi, API key\)/);
  assert.doesNotMatch(fresh, /Codex|recommended/);
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify({ version: 4, active_provider: 'openai', harness: 'codex', providers: { openai: { auth_method: 'subscription' } }, channels: {} }));
  const onCodex = list();
  assert.ok(onCodex.indexOf('GLM (Z.ai)') < onCodex.indexOf('OpenAI (Codex)'), onCodex);
  assert.match(onCodex, /OpenAI \(Codex\) · not offered in this release: jht setup/);
  assert.doesNotMatch(onCodex, /recommended|jht providers update/);
});

test('the guided setup names the chosen provider in its command without questions, and team start never sends to a CLI to install', () => {
  for (const lang of ['en', 'it']) {
    const intro = JSON.parse(readFileSync(join(cli, '..', 'shared', 'locales', `${lang}.json`), 'utf8'))['wizard.key.intro'];
    assert.match(intro, /--provider %s --api-key-stdin/, lang);
    assert.doesNotMatch(intro, /glm\|kimi|--harness/, lang);
  }
  const startAgent = readFileSync(join(cli, '..', '.launcher', 'start-agent.sh'), 'utf8');
  assert.doesNotMatch(startAgent, /github\.com\/openai\/codex|Install the Claude CLI|Install the Kimi CLI/);
  assert.match(startAgent, /is not offered in this release: the team runs on Pi with an API key\. Run: jht setup/);
});
