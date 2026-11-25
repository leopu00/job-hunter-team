// `jht setup` (the guided wizard) with a key: GLM and Kimi (hidden key, kept in the key store, Pi, no sign-in), Codex with an OpenAI key
// (handed to `codex login --with-api-key` on its standard input), a setup that is cancelled (leaves things as they were), and what
// `jht doctor` says after a setup with a key. Every key and every answer of the provider is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { offeredInRelease, offeredWay, RELEASE_PROVIDERS } from '../../shared/runtime/release-providers.js';
const codexSkip = offeredWay('openai', 'codex') ? false : 'Codex and Pi with ChatGPT are not offered in this release (shared/runtime/release-providers.js)';

const cli = fileURLToPath(new URL('..', import.meta.url));
const KEY = ['synthetic', 'key', '0123456789', 'abcdef'].join('-'); // built, so that no scanner reads it as a key
const OTHER = ['synthetic', 'key', 'fedcba', '9876543210'].join('-');

function sandbox({ installFails = false, existingConfig = null, piLogsIn = true, teamStartFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-wizard-key-'));
  const home = join(root, '.jht');
  const deps = join(root, 'deps');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  if (existingConfig) writeFileSync(join(home, 'jht.config.json'), existingConfig);
  const calls = join(root, 'calls.log');
  const fake = join(root, 'fake-jht.js');
  writeFileSync(fake, `const fs = require('node:fs'); fs.appendFileSync(${JSON.stringify(calls)}, 'jht ' + process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] === 'team' && process.argv[3] === 'start') fs.appendFileSync(${JSON.stringify(join(root, 'flag-at-start.log'))}, fs.existsSync(require('node:path').join(process.env.JHT_HOME, '.setup-open.flag')) ? 'present\\n' : 'absent\\n');\nprocess.exit(${installFails ? "process.argv[2] === 'providers' ? 1 : 0" : teamStartFails ? "process.argv[2] === 'team' && process.argv[3] === 'start' ? 1 : 0" : '0'});\n`);
  // a codex that takes its key from the standard input like `codex login --with-api-key`, and writes the marker
  const codex = join(bin, 'codex');
  writeFileSync(codex, `#!/bin/sh
echo "codex $*" >> ${JSON.stringify(calls)}
if [ "$1 $2" = "login --with-api-key" ]; then
  IFS= read -r line
  printf '%s' "$line" > ${JSON.stringify(join(root, 'codex-stdin'))}
  mkdir -p "$JHT_HOME/.codex" && echo '{"OPENAI_API_KEY":"x"}' > "$JHT_HOME/.codex/auth.json"
fi
`);
  chmodSync(codex, 0o755);
  // a pi that signs in like /login does (an entry named openai: the ChatGPT account), or leaves without a login
  const pi = join(bin, 'pi');
  writeFileSync(pi, `#!/bin/sh
echo "pi $* dir=$PI_CODING_AGENT_DIR" >> ${JSON.stringify(calls)}
if [ -f "$JHT_HOME/.setup-open.flag" ]; then echo present >> ${JSON.stringify(join(root, 'flag-at-login.log'))}; else echo absent >> ${JSON.stringify(join(root, 'flag-at-login.log'))}; fi
${piLogsIn ? `mkdir -p "$PI_CODING_AGENT_DIR" && echo '{"openai":{"type":"oauth","access":"synthetic"}}' > "$PI_CODING_AGENT_DIR/auth.json"` : 'true'}
`);
  chmodSync(pi, 0o755);
  const driver = join(root, 'driver.mjs');
  writeFileSync(driver, `
const verdicts = JSON.parse(process.env.FAKE_VERDICTS || '[]');
// a verdict is a status, or { status, body } for an answer whose words count (an account with no credit)
globalThis.fetch = async () => { const v = verdicts.shift() ?? 200; const status = typeof v === 'object' ? v.status : v;
  return { status, ok: status < 400, text: async () => (typeof v === 'object' ? v.body : '') }; };
const { runSetupWizard } = await import(${JSON.stringify(join(cli, 'wizard/setup.js'))});
const { WizardCancelledError } = await import(${JSON.stringify(join(cli, 'wizard/prompts.js'))});
const say = (kind, data) => console.log('EV ' + JSON.stringify({ kind, ...data }));
const answers = JSON.parse(process.env.WIZARD_ANSWERS || '{}');
const keys = [...(answers.keys ?? [])];
const prompter = {
  intro: async () => {}, outro: async (message) => say('outro', { message }),
  note: async (message, title) => say('note', { message, title }),
  select: async (p) => { say('select', { message: p.message, options: p.options.map((o) => o.value), initial: p.initialValue });
    const wanted = answers.select?.[p.message] ?? answers.byOptions?.[p.options.map((o) => o.value).join()];
    return p.options.some((o) => o.value === wanted) ? wanted : (p.initialValue ?? p.options[0].value); },
  multiselect: async () => [], text: async (p) => { say('text', { message: p.message }); return answers.text?.[p.message] ?? ''; },
  password: async (p) => { say('password', { message: p.message, rejects: p.validate?.('short') ?? null }); return keys.shift() ?? ''; },
  confirm: async (p) => { if (answers.cancelAtConfirm) throw new WizardCancelledError(); return answers.confirm ?? p.initialValue ?? true; },
  progress: () => ({ update() {}, stop() {} }),
};
// FAKE_DISK: what the disk guard says after a team start that failed (low = the agents refused for the disk)
const disk = process.env.FAKE_DISK ? { diskRefusal: () => (process.env.FAKE_DISK === 'low' ? { code: 'disk_low', message: 'SYNTHETIC DISK SENTENCE' } : null) } : undefined;
try { say('result', { ok: await runSetupWizard(prompter, disk) }); } catch (err) { say('cancelled', { name: err.name }); }
`);
  return { root, home, deps, bin, calls, fake, driver };
}

function run(box, answers = {}, verdicts = [], extraEnv = {}) {
  const r = spawnSync(process.execPath, [box.driver], {
    env: { PATH: `${box.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, JHT_HOME: box.home, JHT_DEPS_PREFIX: box.deps, JHT_NODE_ENTRY: box.fake,
      LANG: 'en_US.UTF-8', NO_COLOR: '1', WIZARD_ANSWERS: JSON.stringify(answers), FAKE_VERDICTS: JSON.stringify(verdicts), ...extraEnv },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  const events = r.stdout.split('\n').filter((l) => l.startsWith('EV ')).map((l) => JSON.parse(l.slice(3)));
  const calls = existsSync(box.calls) ? readFileSync(box.calls, 'utf8').trim().split('\n') : [];
  const configPath = join(box.home, 'jht.config.json');
  return { r, events, calls, configText: existsSync(configPath) ? readFileSync(configPath, 'utf8') : null, out: r.stdout + r.stderr };
}
const keyFiles = (box) => (existsSync(join(box.deps, 'keys')) ? readdirSync(join(box.deps, 'keys')) : []);

for (const provider of ['glm', 'kimi'].filter((p) => offeredInRelease(p))) {
  test(`${provider} in the wizard: the services of the release only, the key typed hidden, kept in the key store, Pi, no sign-in, config at the latest version`, () => {
    const box = sandbox();
    const { r, events, calls, configText, out } = run(box, { select: { 'AI Provider': provider }, keys: [KEY] });
    assert.equal(r.status, 0, r.stderr);
    // one service is said, not asked; more than one is a question with only them; the others are «coming», never a choice
    const offered = RELEASE_PROVIDERS;
    const ask = events.find((e) => e.kind === 'select' && e.message === 'AI Provider');
    if (offered.length === 1) assert.equal(ask, undefined);
    else assert.deepEqual(ask.options, offered);
    assert.ok(events.some((e) => e.kind === 'note' && /coming in a later release/.test(e.message)));
    assert.equal(events.some((e) => e.kind === 'select' && /Program that runs the agents|How does Codex sign in/.test(e.message)), false, 'no harness and no Codex question');
    const hidden = events.find((e) => e.kind === 'password');
    assert.ok(hidden && hidden.rejects, 'the key is asked hidden and a short one is refused at the prompt');
    const config = JSON.parse(configText);
    assert.equal(config.active_provider, provider);
    assert.equal(config.harness, 'pi');
    assert.equal(config.version, 4, 'a new config is born at the latest version');
    assert.equal(config.providers[provider].auth_method, 'api_key');
    const path = config.providers[provider].api_key_ref.path;
    assert.equal(path, join(box.deps, 'keys', `${provider}.key`));
    assert.equal(readFileSync(path, 'utf8'), `${KEY}\n`);
    // no key in the config, in what was said, or in what the setup printed
    assert.equal(configText.includes(KEY), false);
    assert.equal(out.includes(KEY), false);
    assert.equal(calls.some((c) => c.startsWith('pi ')), false, 'no Pi sign-in');
    assert.ok(calls.includes('jht providers update pi'));
    assert.ok(calls.includes('jht team start'));
    assert.equal(events.at(-1).ok, true);
  });
}

test('OpenAI in the wizard with the ChatGPT subscription: Pi, its own sign-in, no key asked, no email, no Codex', () => {
  const box = sandbox();
  const { r, events, calls, configText, out } = run(box, { select: { 'AI Provider': 'openai', 'How does Pi sign in to OpenAI?': 'subscription' } });
  assert.equal(r.status, 0, r.stderr);
  const ask = events.find((e) => e.kind === 'select' && e.message === 'How does Pi sign in to OpenAI?');
  assert.deepEqual(ask.options, ['subscription', 'api_key']);
  assert.equal(events.some((e) => e.kind === 'password'), false, 'no key is asked');
  assert.equal(events.some((e) => e.kind === 'select' && /Program that runs the agents|How does Codex sign in/.test(e.message)), false);
  assert.ok(events.some((e) => e.kind === 'note' && /Pi signs in to ChatGPT with its own login/.test(e.message)), 'what Pi needs is said');
  const config = JSON.parse(configText);
  assert.equal(config.active_provider, 'openai');
  assert.equal(config.harness, 'pi');
  assert.equal(config.providers.openai.auth_method, 'subscription');
  assert.equal(config.providers.openai.api_key_ref, undefined);
  assert.equal(config.providers.openai.subscription, undefined);
  // Pi is installed (not Codex), then opened for its /login in the team's own folder, then the team starts
  const order = calls.map((c) => c.replace(/ dir=.*/, ''));
  assert.ok(order.includes('jht providers update pi'));
  assert.equal(order.some((c) => /^codex |providers update codex/.test(c)), false, 'Codex is not touched');
  assert.ok(order.findIndex((c) => c.startsWith('pi ')) > order.indexOf('jht providers update pi'));
  assert.ok(order.indexOf('jht team start') > order.findIndex((c) => c.startsWith('pi ')));
  assert.match(calls.find((c) => c.startsWith('pi ')), new RegExp(`dir=${join(box.home, '.pi', 'agent').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.equal(keyFiles(box).length, 0, 'no key kept');
  assert.equal(events.at(-1).ok, true, out);
});

test('OpenAI with the ChatGPT subscription and a Pi that leaves without a login: the setup stops before the team starts', () => {
  const box = sandbox({ piLogsIn: false });
  const { events, calls } = run(box, { select: { 'AI Provider': 'openai', 'How does Pi sign in to OpenAI?': 'subscription' } });
  assert.equal(events.at(-1).ok, false);
  assert.equal(calls.includes('jht team start'), false);
});

test('OpenAI asks how Pi signs in, and with nothing set up the default is the key (the way of build 7 stays the default)', () => {
  const { events, configText } = run(sandbox(), { select: { 'AI Provider': 'openai' }, keys: [`sk-${KEY}`] });
  assert.equal(events.find((e) => e.kind === 'select' && e.message === 'How does Pi sign in to OpenAI?').initial, 'api_key');
  assert.equal(JSON.parse(configText).providers.openai.auth_method, 'api_key');
});

test('OpenAI in the wizard: offered with a key on Pi, the key checked with OpenAI and kept in the key store, no Codex sign-in', () => {
  const box = sandbox();
  const { r, events, calls, configText, out } = run(box, { select: { 'AI Provider': 'openai' }, keys: [`sk-${KEY}`] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(events.find((e) => e.kind === 'select' && e.message === 'AI Provider').options, [...RELEASE_PROVIDERS]);
  const config = JSON.parse(configText);
  assert.equal(config.active_provider, 'openai');
  assert.equal(config.harness, 'pi');
  assert.equal(config.providers.openai.auth_method, 'api_key');
  assert.equal(config.providers.openai.api_key_ref.path, join(box.deps, 'keys', 'openai.key'));
  assert.match(out, /OpenAI accepted the API key/);
  assert.equal(configText.includes(KEY) || out.includes(KEY), false);
  assert.equal(calls.some((c) => /^codex /.test(c)), false, 'no Codex sign-in');
  assert.ok(calls.includes('jht providers update pi'));
  assert.equal(events.at(-1).ok, true);
});

test('Claude in the wizard: offered with a key on Pi, kept in the key store, Opus for the setup\'s model, no Claude Code sign-in', () => {
  const box = sandbox();
  const { r, events, calls, configText, out } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY] });
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(configText);
  assert.deepEqual([config.active_provider, config.harness, config.providers.claude.auth_method], ['claude', 'pi', 'api_key']);
  assert.equal(config.providers.claude.model, 'claude-opus-5-5');
  assert.equal(config.providers.claude.api_key_ref.path, join(box.deps, 'keys', 'claude.key'));
  assert.match(out, /Claude \(Anthropic\) accepted the API key/);
  assert.equal(calls.some((c) => /^claude /.test(c)), false, 'no Claude Code sign-in');
  assert.equal(configText.includes(KEY) || out.includes(KEY), false);
  assert.equal(events.at(-1).ok, true);
});

test('a key the provider accepts on an empty account (Z.ai 429 code 1113): kept, and the end of the setup says top it up, not «All set»', () => {
  const box = sandbox();
  const empty = { status: 429, body: '{"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}' };
  const { events, configText, out } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY] }, [empty]);
  assert.equal(events.at(-1).ok, true);
  assert.equal(readFileSync(JSON.parse(configText).providers.claude.api_key_ref.path, 'utf8'), `${KEY}\n`, 'the key is right: it is kept');
  assert.match(out, /Claude \(Anthropic\) accepted the API key, but the account has no credit left/);
  const outro = events.find((e) => e.kind === 'outro').message;
  assert.match(outro, /the credit on Claude \(Anthropic\) is used up/);
  assert.doesNotMatch(outro, /All set/);
  assert.equal(out.includes(KEY), false);
});

test('the end of the setup does not ask to start the onboarding when the Assistente already closed it', () => {
  const box = sandbox();
  mkdirSync(join(box.home, 'profile'), { recursive: true });
  writeFileSync(join(box.home, 'profile', 'ready.flag'), '');
  const { events } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY] }, [200]);
  const outro = events.find((e) => e.kind === 'outro').message;
  assert.match(outro, /^All set! The team is running/);
  assert.doesNotMatch(outro, /onboarding|Assistente/);
  assert.match(outro, /jht team status/);
});

test('a key the provider accepts says the credit is not checked there, and the setup ends «All set»', () => {
  const box = sandbox();
  const { events, out } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY] }, [200]);
  assert.match(out, /accepted the API key\. The credit of the account is not checked here/);
  assert.match(events.find((e) => e.kind === 'outro').message, /^All set!/);
});

test('a key the provider refuses three times saves nothing: no config, no key file, and what to do is said', () => {
  const box = sandbox();
  const { events, configText, out } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY, OTHER, KEY] }, [401, 401, 401]);
  assert.equal(configText, null);
  assert.deepEqual(keyFiles(box), []);
  assert.equal(events.at(-1).ok, false);
  assert.match(out, /did not accept the API key/);
  assert.match(out, /run: jht setup/);
  assert.equal(out.includes(KEY) || out.includes(OTHER), false);
});

test('a refused key is asked again, and the one the provider accepts is the one kept', () => {
  const box = sandbox();
  const { events, configText } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY, OTHER] }, [401, 200]);
  assert.equal(events.at(-1).ok, true);
  assert.equal(readFileSync(JSON.parse(configText).providers.claude.api_key_ref.path, 'utf8'), `${OTHER}\n`);
});

test('Codex with an OpenAI key: hidden, checked, handed to codex login --with-api-key on its standard input, the config holds no key', { skip: codexSkip }, () => {
  const box = sandbox();
  const { r, events, calls, configText, out } = run(box, { select: { 'How does Codex sign in?': 'api_key' }, keys: [KEY] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(events.find((e) => e.kind === 'select' && /Codex sign in/.test(e.message)).options, ['subscription', 'api_key']);
  assert.equal(readFileSync(join(box.root, 'codex-stdin'), 'utf8'), KEY);
  assert.ok(calls.includes('codex login --with-api-key'));
  assert.equal(calls.some((c) => /device-auth/.test(c)), false, 'no device sign-in');
  const config = JSON.parse(configText);
  assert.equal(config.providers.openai.auth_method, 'cli');
  assert.equal(config.harness, 'codex');
  assert.equal(configText.includes(KEY) || out.includes(KEY), false);
  assert.deepEqual(keyFiles(box), [], 'the key store is not used for Codex');
  assert.equal(events.at(-1).ok, true);
});

test('Codex with the subscription is the default and asks for no key', { skip: codexSkip }, () => {
  const box = sandbox();
  mkdirSync(join(box.home, '.codex'), { recursive: true });
  writeFileSync(join(box.home, '.codex/auth.json'), '{}');
  const { events, calls } = run(box);
  assert.equal(events.some((e) => e.kind === 'password'), false);
  assert.equal(calls.some((c) => c.startsWith('codex login --with-api-key')), false);
  assert.equal(events.at(-1).ok, true);
});

test('Codex that does not take the key stops the setup and says so', { skip: codexSkip }, () => {
  const box = sandbox();
  writeFileSync(join(box.bin, 'codex'), '#!/bin/sh\nexit 1\n');
  const { events, out } = run(box, { select: { 'How does Codex sign in?': 'api_key' }, keys: [KEY] });
  assert.equal(events.at(-1).ok, false);
  assert.match(out, /Codex did not take the key/);
  assert.equal(out.includes(KEY), false);
});

test('a setup cancelled after the config was saved leaves no config and no key', () => {
  const box = sandbox({ installFails: true });
  const { events, configText } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY], cancelAtConfirm: true });
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.equal(configText, null);
  assert.deepEqual(keyFiles(box), []);
});

test('a setup cancelled over a config that was there leaves that config byte for byte', () => {
  const before = JSON.stringify({ version: 4, active_provider: 'openai', providers: { openai: { name: 'openai', auth_method: 'subscription', model: 'm' } }, channels: {} }, null, 2);
  const box = sandbox({ installFails: true, existingConfig: before });
  const { events, configText } = run(box, { select: { 'Config management': 'modify', 'AI Provider': 'claude' }, keys: [KEY], cancelAtConfirm: true });
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.equal(configText, before);
});

test('after a non-interactive setup with a key, jht doctor offers no migration and finds the key', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-doctor-key-'));
  const home = join(root, '.jht');
  mkdirSync(home, { recursive: true });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, JHT_HOME: home, JHT_DEPS_PREFIX: join(root, 'deps'), LANG: 'en_US.UTF-8', NO_COLOR: '1', JHT_LANG: 'en' };
  const entry = join(cli, 'bin/jht.js');
  const setup = spawnSync(process.execPath, [entry, 'setup', '--non-interactive', '--provider', 'claude', '--harness', 'pi', '--api-key-stdin', '--skip-health', '--language', 'en'],
    { env, input: `${KEY}\n`, encoding: 'utf8', timeout: 60_000 });
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  assert.equal(JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8')).version, 4);
  const doctor = spawnSync(process.execPath, [entry, 'doctor', '--all'], { env, encoding: 'utf8', timeout: 60_000 });
  const said = doctor.stdout + doctor.stderr;
  assert.doesNotMatch(said, /jht migrate|update available/, said);
  assert.doesNotMatch(said, /has no API key/, said);
  assert.match(said, /Provider: claude/, said);
  assert.equal(said.includes(KEY), false);
});

test('doctor says a key is missing when the reference leads to nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-doctor-nokey-'));
  const home = join(root, '.jht');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify({ version: 4, active_provider: 'claude', harness: 'pi',
    providers: { claude: { name: 'claude', auth_method: 'api_key', model: 'm', api_key_ref: { type: 'ref', source: 'file', path: join(root, 'absent.key') } } }, channels: {} }));
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, JHT_HOME: home, LANG: 'en_US.UTF-8', NO_COLOR: '1', JHT_LANG: 'en' };
  const doctor = spawnSync(process.execPath, [join(cli, 'bin/jht.js'), 'doctor', '--all'], { env, encoding: 'utf8', timeout: 60_000 });
  assert.match(doctor.stdout + doctor.stderr, /Provider claude has no API key/);
});

test('a setup cancelled over a key that was already stored puts that key back, and one cancelled at the question for the key stores nothing', () => {
  const box = sandbox({ installFails: true });
  mkdirSync(join(box.deps, 'keys'), { recursive: true, mode: 0o700 });
  writeFileSync(join(box.deps, 'keys', 'claude.key'), `${OTHER}\n`, { mode: 0o600 });
  const { events } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY], cancelAtConfirm: true });
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.equal(readFileSync(join(box.deps, 'keys', 'claude.key'), 'utf8'), `${OTHER}\n`, 'the key that worked is still there');
});

test('a cancel that comes before the key store is written (at the key question) leaves no key file', () => {
  const box = sandbox();
  const driver = readFileSync(box.driver, 'utf8').replace("password: async (p) => {", "password: async (p) => { if (answers.cancelAtPassword) throw new WizardCancelledError();");
  writeFileSync(box.driver, driver);
  const { events } = run(box, { select: { 'AI Provider': 'claude' }, cancelAtPassword: true });
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.deepEqual(keyFiles(box), []);
});

test('a kept configuration of the ChatGPT subscription (Codex) from 0.3.9 is kept as it is, with the one warning', () => {
  const before = JSON.stringify({ version: 4, active_provider: 'openai', harness: 'codex', providers: { openai: { name: 'openai', auth_method: 'subscription', model: 'm' } }, channels: {} });
  const box = sandbox({ existingConfig: before });
  mkdirSync(join(box.home, '.codex'), { recursive: true });
  writeFileSync(join(box.home, '.codex/auth.json'), '{}');
  const { events, configText } = run(box, { select: { 'Config management': 'keep' } });
  assert.ok(events.some((e) => e.kind === 'note' && /no longer offered to new users from 0\.4\.0: your team keeps working/.test(e.message)));
  assert.equal(configText, before, 'nothing is rewritten');
  assert.equal(events.at(-1).ok, true);
});

test('a kept configuration of a service this release does not offer is said, and the setup goes on with the offered one', () => {
  const before = JSON.stringify({ version: 4, active_provider: 'kimi', harness: 'codex', providers: { kimi: { name: 'kimi', auth_method: 'subscription', model: 'm' } }, channels: {} });
  const box = sandbox({ existingConfig: before });
  const { events, configText } = run(box, { select: { 'Config management': 'keep' }, keys: [KEY] });
  assert.ok(events.some((e) => e.kind === 'note' && /for kimi, which this release does not offer/.test(e.message)));
  assert.equal(JSON.parse(configText).active_provider, RELEASE_PROVIDERS[0]);
  assert.equal(events.at(-1).ok, true);
});

test('the budget in the wizard: the trial of $5 for 30 minutes is the answer already chosen, saved as team.budget, 24/7, and said in one line', () => {
  const box = sandbox();
  const t0 = Date.now();
  const { events, configText } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY] });
  const ask = events.find((e) => e.kind === 'select' && e.message === 'How much should the team work?');
  assert.deepEqual(ask.options, ['trial', 'night', 'days', 'none']);
  assert.equal(events.some((e) => e.kind === 'select' && e.message === 'When should the team work?'), false, 'the old hours question is not asked');
  const { budget, working_hours: hours } = JSON.parse(configText).team;
  assert.equal(budget.usd, 5);
  assert.equal(budget.set_by, 'setup');
  assert.equal(budget.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, 'the zone of the person goes with the budget');
  assert.equal(budget.duration_minutes, 30);
  assert.equal(budget.starts_at, undefined, 'the 30 minutes start when the team starts working, not at the setup');
  assert.ok(Date.parse(budget.saved_at) >= t0 - 1000 && Date.parse(budget.saved_at) <= Date.now());
  assert.equal(hours, undefined, 'no working hours = 24/7 for the trial');
  assert.ok(events.some((e) => e.kind === 'note' && e.message === 'The team can spend $5 in all; the 30 minutes start when the team starts working, then it stops by itself.'));
  assert.equal(events.at(-1).ok, true);
});

test('the budget in the wizard: «a few days» asks the amount, the days and the hours, and saves the period with the hours in the zone of the person', () => {
  const box = sandbox();
  const { events, configText } = run(box, {
    select: { 'AI Provider': 'claude', 'How much should the team work?': 'days', 'For how many days?': 3, 'When does it work?': 'ten_from_8' },
    text: { 'How many dollars in total?': '10' },
    keys: [KEY],
  });
  const { budget, working_hours: hours } = JSON.parse(configText).team;
  assert.equal(budget.usd, 10);
  assert.equal(budget.duration_minutes, 72 * 60);
  assert.deepEqual(hours.windows, [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start: '08:00', end: '18:00' }]);
  assert.ok(hours.timezone);
  assert.ok(events.some((e) => e.kind === 'note' && e.message.startsWith(`The team can spend $10 in all, for 3 days from when it starts working, 10 hours a day (8:00-18:00 ${hours.timezone}), then it stops by itself.`) && e.message.includes('works until the budget of the period is spent')));
  assert.equal(budget.pace, undefined, 'the pace is off unless the person says yes');
});

test('the budget in the wizard: a yes to the pace saves it in the budget and the note says it is spread over the time', () => {
  const box = sandbox();
  const { events, configText } = run(box, {
    select: { 'AI Provider': 'claude', 'How much should the team work?': 'days', 'For how many days?': 3, 'When does it work?': 'ten_from_8' },
    text: { 'How many dollars in total?': '10' },
    confirm: true,
    keys: [KEY],
  });
  assert.equal(JSON.parse(configText).team.budget.pace, true);
  assert.ok(events.some((e) => e.kind === 'note' && e.message.includes('spread over the time')));
});

test('the budget in the wizard: «no limit» warns, saves no budget and asks the working hours as before', () => {
  const box = sandbox();
  const { events, configText } = run(box, { select: { 'AI Provider': 'claude', 'How much should the team work?': 'none', 'When should the team work?': 'office' }, keys: [KEY] });
  assert.ok(events.some((e) => e.kind === 'note' && /spends as long as there is credit on your account/.test(e.message)));
  const team = JSON.parse(configText).team;
  assert.equal(team.budget, undefined);
  assert.deepEqual(team.working_hours.windows[0].days, ['mon', 'tue', 'wed', 'thu', 'fri']);
});

test('the budget in the wizard: a reset with the same trial opens a new period (the old one may be spent or over)', () => {
  const saved = '2026-11-15T21:30:00.000Z';
  const before = JSON.stringify({ version: 4, active_provider: 'claude', harness: 'pi', providers: { claude: { name: 'claude', auth_method: 'api_key', model: 'm' } }, channels: {},
    team: { budget: { usd: 5, duration_minutes: 30, saved_at: saved, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, set_by: 'setup' } } });
  const box = sandbox({ existingConfig: before });
  const { configText } = run(box, { select: { 'Config management': 'reset', 'AI Provider': 'claude' }, keys: [KEY] });
  assert.notEqual(JSON.parse(configText).team.budget.saved_at, saved, 'the same trial after a reset is a new period');
  const box2 = sandbox({ existingConfig: before.replace('"usd":5', '"usd":7') });
  const second = run(box2, { select: { 'Config management': 'reset', 'AI Provider': 'claude' }, keys: [KEY] });
  assert.notEqual(JSON.parse(second.configText).team.budget.saved_at, saved, 'another amount starts again');
});

test('agents refused for the disk at the end of the setup: set up and saved, the team needs space, and the setup ends with 3 (giro Mac build8)', async () => {
  const box = sandbox({ teamStartFails: true });
  const { events, calls, configText } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY] }, [200], { FAKE_DISK: 'low' });
  assert.ok(calls.includes('jht team start'));
  assert.ok(configText, 'the configuration is saved');
  const outro = events.find((e) => e.kind === 'outro').message;
  assert.match(outro, /^The setup is done and your configuration is saved, but the team cannot start: the disk needs more free space\./);
  assert.match(outro, /SYNTHETIC DISK SENTENCE/);
  assert.match(outro, /jht team start/);
  assert.doesNotMatch(outro, /Team start failed/);
  assert.equal(events.at(-1).ok, 'team_needs_space');
  const { setupExitCode } = await import('../wizard/setup.js');
  assert.equal(setupExitCode('team_needs_space'), 3);
  assert.equal(setupExitCode(true), 0);
  assert.equal(setupExitCode(false), 1);
});

test('a team start that failed for something else than the disk is still a failed setup', () => {
  const box = sandbox({ teamStartFails: true });
  const { events } = run(box, { select: { 'AI Provider': 'claude' }, keys: [KEY] }, [200], { FAKE_DISK: 'ok' });
  assert.match(events.find((e) => e.kind === 'outro').message, /Team start failed/);
  assert.equal(events.at(-1).ok, false);
});

test('while the setup is open the flag stands (the watchdogs start nothing), and it is gone before the team starts and at the end', () => {
  const box = sandbox();
  const { r } = run(box, { select: { 'AI Provider': 'openai', 'How does Pi sign in to OpenAI?': 'subscription' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(box.root, 'flag-at-login.log'), 'utf8').trim(), 'present', 'the sign-in of Pi is made with the setup open');
  assert.equal(readFileSync(join(box.root, 'flag-at-start.log'), 'utf8').trim(), 'absent', 'the setup takes it off before it starts the team itself');
  assert.equal(existsSync(join(box.home, '.setup-open.flag')), false);
});

test('a setup that leaves without a sign-in does not leave the flag behind', () => {
  const box = sandbox({ piLogsIn: false });
  run(box, { select: { 'AI Provider': 'openai', 'How does Pi sign in to OpenAI?': 'subscription' } });
  assert.equal(existsSync(join(box.home, '.setup-open.flag')), false);
});

// «Update the values» with the same service and a key already kept (the VPS round of build9): the key is not asked again, keeping it is the default
const keptBefore = (provider) => JSON.stringify({ version: 4, active_provider: provider, harness: 'pi', providers: { [provider]: { name: provider, auth_method: 'api_key', model: 'm' } }, channels: {} });
function withKeptKey(provider) {
  const box = sandbox({ existingConfig: keptBefore(provider) });
  mkdirSync(join(box.deps, 'keys'), { recursive: true, mode: 0o700 });
  writeFileSync(join(box.deps, 'keys', `${provider}.key`), `${KEY}\n`, { mode: 0o600 });
  return box;
}
const keepAsk = (events) => events.find((e) => e.kind === 'select' && e.options.join() === 'keep,new');

test('same service, a key kept that the provider accepts: «keep the key» is the default and no key is typed', () => {
  const box = withKeptKey('claude');
  const { r, events, configText, out } = run(box, { select: { 'Config management': 'modify', 'AI Provider': 'claude' } }, [200]);
  assert.equal(r.status, 0, r.stderr);
  const ask = keepAsk(events);
  assert.ok(ask, 'the choice to keep the key is offered');
  assert.equal(ask.initial, 'keep');
  assert.equal(events.some((e) => e.kind === 'password'), false, 'nothing is typed');
  const config = JSON.parse(configText);
  assert.equal(config.providers.claude.api_key_ref.path, join(box.deps, 'keys', 'claude.key'));
  assert.equal(readFileSync(join(box.deps, 'keys', 'claude.key'), 'utf8'), `${KEY}\n`, 'the key is as it was');
  assert.equal(out.includes(KEY), false);
});

test('same service and «a new key»: the key is asked and replaces the old one', () => {
  const box = withKeptKey('claude');
  const { events } = run(box, { select: { 'Config management': 'modify', 'AI Provider': 'claude' }, byOptions: { 'keep,new': 'new' }, keys: [OTHER] }, [200, 200]);
  assert.ok(keepAsk(events));
  assert.ok(events.some((e) => e.kind === 'password'));
  assert.equal(readFileSync(join(box.deps, 'keys', 'claude.key'), 'utf8'), `${OTHER}\n`);
});

test('a kept key the provider refuses is not offered: the key is asked', () => {
  const box = withKeptKey('claude');
  const { events } = run(box, { select: { 'Config management': 'modify', 'AI Provider': 'claude' }, keys: [OTHER] }, [401, 200]);
  assert.equal(keepAsk(events), undefined);
  assert.ok(events.some((e) => e.kind === 'password'));
});

test('another service than the saved one: the key of that service is asked, nothing is offered to keep', () => {
  const box = withKeptKey('claude');
  const { events } = run(box, { select: { 'Config management': 'modify', 'AI Provider': 'openai' }, keys: [`sk-${OTHER}`] }, [200]);
  assert.equal(keepAsk(events), undefined);
});
