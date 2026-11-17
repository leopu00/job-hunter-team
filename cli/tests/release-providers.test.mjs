// The services of this release are ONE list (shared/runtime/release-providers.js). Bringing one back is that line and this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_OFFERS, RELEASE_PROVIDERS, RELEASE_HARNESS, codexLegacy, configOffered, notOfferedReason, offeredInRelease, offeredWay, offersSentence } from '../../shared/runtime/release-providers.js';
import { WIZARD_PROVIDERS } from '../wizard/setup.js';

const cli = fileURLToPath(new URL('..', import.meta.url));

test('this release offers GLM, Kimi, OpenAI and Claude, on Pi with a key; the wizard offers exactly the list', () => {
  assert.deepEqual([...RELEASE_PROVIDERS], ['glm', 'kimi', 'openai', 'claude']);
  assert.deepEqual(RELEASE_OFFERS.map((o) => [o.provider, o.harness, o.auth]), [['glm', 'pi', 'api_key'], ['kimi', 'pi', 'api_key'], ['openai', 'pi', 'api_key'], ['claude', 'pi', 'api_key'], ['openai', 'pi', 'subscription']]);
  assert.equal(RELEASE_HARNESS, 'pi');
  assert.deepEqual(WIZARD_PROVIDERS.map((p) => p.value), [...RELEASE_PROVIDERS]);
  for (const name of ['codex', '', null, 'gemini']) assert.equal(offeredInRelease(name), false, String(name));
  for (const name of [' GLM ', 'kimi', 'Moonshot', 'openai', 'claude', 'Anthropic']) assert.equal(offeredInRelease(name), true, name);
  // Claude only with a key: a team on the Claude subscription is not a way of this release
  assert.equal(configOffered({ active_provider: 'claude', harness: 'pi', providers: { claude: { auth_method: 'subscription' } } }), false);
  // OpenAI with a key on pi, not Codex: a team on the ChatGPT subscription is not a way of this release
  assert.equal(offeredWay('openai', 'pi', 'api_key'), true);
  assert.equal(offeredWay('openai', 'codex'), false);
  // ... and with the ChatGPT subscription on pi (Pi's own sign-in): a way too; the same subscription on codex is still not
  assert.equal(offeredWay('openai', 'pi', 'subscription'), true);
  assert.equal(offeredWay('openai', 'codex', 'subscription'), false);
  assert.equal(configOffered({ active_provider: 'openai', harness: 'pi', providers: { openai: { auth_method: 'subscription' } } }), true);
  assert.equal(codexLegacy({ active_provider: 'openai', harness: 'pi', providers: { openai: { auth_method: 'subscription' } } }), false);
  // the other services never take a subscription on pi
  for (const name of ['glm', 'kimi', 'claude']) assert.equal(offeredWay(name, 'pi', 'subscription'), false, name);
  assert.equal(configOffered({ active_provider: 'openai', harness: 'codex', providers: { openai: { auth_method: 'subscription' } } }), false);
  assert.equal(configOffered({ active_provider: 'openai', harness: 'pi', providers: { openai: { auth_method: 'api_key' } } }), true);
  assert.equal(configOffered({ active_provider: 'moonshot', harness: 'pi', providers: { moonshot: { auth_method: 'api_key' } } }), true);
});

// What doctor, status and providers say for a config, in a home of its own (no team, no network)
function said(config, args) {
  const root = mkdtempSync(join(tmpdir(), 'jht-release-'));
  const home = join(root, '.jht');
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex/auth.json'), '{}');
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify({ version: 4, channels: {}, ...config }));
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, JHT_HOME: home, LANG: 'en_US.UTF-8', NO_COLOR: '1', JHT_LANG: 'en', COLUMNS: '200' };
  const done = spawnSync(process.execPath, [join(cli, 'bin/jht.js'), ...args], { env, encoding: 'utf8', timeout: 60_000 });
  return { text: (done.stdout + done.stderr).replace(/\s+/g, ' '), config: readFileSync(join(home, 'jht.config.json'), 'utf8') };
}
const CODEX_039 = { active_provider: 'openai', harness: 'codex', providers: { openai: { name: 'openai', auth_method: 'subscription', model: 'gpt-5.6-sol' } } };
const WARNING = /The ChatGPT subscription \(Codex\) is no longer offered to new users from 0\.4\.0: your team keeps working; to move to GLM, Kimi, OpenAI or Claude with an API key: jht setup/;

test('a team on the ChatGPT subscription (Codex) from 0.3.9: doctor, status and providers accept it with the one warning, and touch nothing', () => {
  assert.equal(notOfferedReason(CODEX_039), 'codex_subscription');
  assert.equal(codexLegacy(CODEX_039), true);
  assert.equal(codexLegacy({ active_provider: 'openai', providers: { openai: { auth_method: 'subscription' } } }), true, 'no harness in the config: codex, as in 0.3.9');
  assert.equal(codexLegacy({ active_provider: 'openai', harness: 'pi', providers: { openai: { auth_method: 'api_key' } } }), false);
  for (const args of [['doctor', '--all'], ['status'], ['providers']]) {
    const { text, config } = said(CODEX_039, args);
    if (args[0] === 'providers') assert.match(text, /OpenAI \(Codex\) · no longer offered to new users from 0\.4\.0, it keeps working/, text);
    else assert.match(text, WARNING, `${args.join(' ')}: ${text}`);
    assert.doesNotMatch(text, /is not supported in this release|not offered in this release \(it runs/, args.join(' '));
    assert.equal(JSON.parse(config).harness, 'codex', 'the config is not touched');
  }
});

test('jht doctor calls a team on a service this release does not offer not supported, with what is offered, and does not touch it', () => {
  const { text } = said({ active_provider: 'kimi', harness: 'codex', providers: { kimi: { name: 'kimi', auth_method: 'subscription', model: 'm' } } }, ['doctor', '--all']);
  assert.match(text, /Provider kimi is not supported in this release \(offered: glm, kimi, openai, claude on Pi with an API key; openai on Pi with the ChatGPT subscription\)/, text);
  assert.match(text, /jht setup \(choose glm and paste its API key/, text);
  assert.equal(offersSentence(), 'glm, kimi, openai, claude on Pi with an API key; openai on Pi with the ChatGPT subscription');
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
  // a team on Codex from 0.3.9 keeps it, with the warning, and keeps its CLI up to the version of the release
  assert.match(onCodex, /OpenAI \(Codex\) · no longer offered to new users from 0\.4\.0, it keeps working/);
  assert.doesNotMatch(onCodex, /recommended/);
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
