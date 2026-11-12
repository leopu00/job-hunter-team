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

const cli = fileURLToPath(new URL('..', import.meta.url));
const KEY = ['synthetic', 'key', '0123456789', 'abcdef'].join('-'); // built, so that no scanner reads it as a key
const OTHER = ['synthetic', 'key', 'fedcba', '9876543210'].join('-');

function sandbox({ installFails = false, existingConfig = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-wizard-key-'));
  const home = join(root, '.jht');
  const deps = join(root, 'deps');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  if (existingConfig) writeFileSync(join(home, 'jht.config.json'), existingConfig);
  const calls = join(root, 'calls.log');
  const fake = join(root, 'fake-jht.js');
  writeFileSync(fake, `require('node:fs').appendFileSync(${JSON.stringify(calls)}, 'jht ' + process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(${installFails ? "process.argv[2] === 'providers' ? 1 : 0" : '0'});\n`);
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
  select: async (p) => { say('select', { message: p.message, options: p.options.map((o) => o.value) });
    const wanted = answers.select?.[p.message];
    return p.options.some((o) => o.value === wanted) ? wanted : (p.initialValue ?? p.options[0].value); },
  multiselect: async () => [], text: async () => '',
  password: async (p) => { say('password', { message: p.message, rejects: p.validate?.('short') ?? null }); return keys.shift() ?? ''; },
  confirm: async (p) => { if (answers.cancelAtConfirm) throw new WizardCancelledError(); return answers.confirm ?? p.initialValue ?? true; },
  progress: () => ({ update() {}, stop() {} }),
};
try { say('result', { ok: await runSetupWizard(prompter) }); } catch (err) { say('cancelled', { name: err.name }); }
`);
  return { root, home, deps, bin, calls, fake, driver };
}

function run(box, answers = {}, verdicts = []) {
  const r = spawnSync(process.execPath, [box.driver], {
    env: { PATH: `${box.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, JHT_HOME: box.home, JHT_DEPS_PREFIX: box.deps, JHT_NODE_ENTRY: box.fake,
      LANG: 'en_US.UTF-8', NO_COLOR: '1', WIZARD_ANSWERS: JSON.stringify(answers), FAKE_VERDICTS: JSON.stringify(verdicts) },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  const events = r.stdout.split('\n').filter((l) => l.startsWith('EV ')).map((l) => JSON.parse(l.slice(3)));
  const calls = existsSync(box.calls) ? readFileSync(box.calls, 'utf8').trim().split('\n') : [];
  const configPath = join(box.home, 'jht.config.json');
  return { r, events, calls, configText: existsSync(configPath) ? readFileSync(configPath, 'utf8') : null, out: r.stdout + r.stderr };
}
const keyFiles = (box) => (existsSync(join(box.deps, 'keys')) ? readdirSync(join(box.deps, 'keys')) : []);

for (const provider of ['glm', 'kimi']) {
  test(`${provider} in the wizard: asked with the others, the key typed hidden, kept in the key store, Pi, no sign-in, config at the latest version`, () => {
    const box = sandbox();
    const { r, events, calls, configText, out } = run(box, { select: { 'AI Provider': provider }, keys: [KEY] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(events.find((e) => e.kind === 'select' && e.message === 'AI Provider').options, ['openai', 'glm', 'kimi']);
    const ask = events.find((e) => e.kind === 'password');
    assert.ok(ask && ask.rejects, 'the key is asked hidden and a short one is refused at the prompt');
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

test('a key the provider accepts on an empty account (Z.ai 429 code 1113): kept, and the end of the setup says top it up, not «All set»', () => {
  const box = sandbox();
  const empty = { status: 429, body: '{"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}' };
  const { events, configText, out } = run(box, { select: { 'AI Provider': 'glm' }, keys: [KEY] }, [empty]);
  assert.equal(events.at(-1).ok, true);
  assert.equal(readFileSync(JSON.parse(configText).providers.glm.api_key_ref.path, 'utf8'), `${KEY}\n`, 'the key is right: it is kept');
  assert.match(out, /GLM \(Z\.ai\) accepted the API key, but the account has no credit left/);
  const outro = events.find((e) => e.kind === 'outro').message;
  assert.match(outro, /the credit on GLM \(Z\.ai\) is used up/);
  assert.doesNotMatch(outro, /All set/);
  assert.equal(out.includes(KEY), false);
});

test('a key the provider accepts says the credit is not checked there, and the setup ends «All set»', () => {
  const box = sandbox();
  const { events, out } = run(box, { select: { 'AI Provider': 'kimi' }, keys: [KEY] }, [200]);
  assert.match(out, /accepted the API key\. The credit of the account is not checked here/);
  assert.match(events.find((e) => e.kind === 'outro').message, /^All set!/);
});

test('a key the provider refuses three times saves nothing: no config, no key file, and what to do is said', () => {
  const box = sandbox();
  const { events, configText, out } = run(box, { select: { 'AI Provider': 'kimi' }, keys: [KEY, OTHER, KEY] }, [401, 401, 401]);
  assert.equal(configText, null);
  assert.deepEqual(keyFiles(box), []);
  assert.equal(events.at(-1).ok, false);
  assert.match(out, /did not accept the API key/);
  assert.match(out, /run: jht setup/);
  assert.equal(out.includes(KEY) || out.includes(OTHER), false);
});

test('a refused key is asked again, and the one the provider accepts is the one kept', () => {
  const box = sandbox();
  const { events, configText } = run(box, { select: { 'AI Provider': 'glm' }, keys: [KEY, OTHER] }, [401, 200]);
  assert.equal(events.at(-1).ok, true);
  assert.equal(readFileSync(JSON.parse(configText).providers.glm.api_key_ref.path, 'utf8'), `${OTHER}\n`);
});

test('Codex with an OpenAI key: hidden, checked, handed to codex login --with-api-key on its standard input, the config holds no key', () => {
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

test('Codex with the subscription is the default and asks for no key', () => {
  const box = sandbox();
  mkdirSync(join(box.home, '.codex'), { recursive: true });
  writeFileSync(join(box.home, '.codex/auth.json'), '{}');
  const { events, calls } = run(box);
  assert.equal(events.some((e) => e.kind === 'password'), false);
  assert.equal(calls.some((c) => c.startsWith('codex login --with-api-key')), false);
  assert.equal(events.at(-1).ok, true);
});

test('Codex that does not take the key stops the setup and says so', () => {
  const box = sandbox();
  writeFileSync(join(box.bin, 'codex'), '#!/bin/sh\nexit 1\n');
  const { events, out } = run(box, { select: { 'How does Codex sign in?': 'api_key' }, keys: [KEY] });
  assert.equal(events.at(-1).ok, false);
  assert.match(out, /Codex did not take the key/);
  assert.equal(out.includes(KEY), false);
});

test('a setup cancelled after the config was saved leaves no config and no key', () => {
  const box = sandbox({ installFails: true });
  const { events, configText } = run(box, { select: { 'AI Provider': 'glm' }, keys: [KEY], cancelAtConfirm: true });
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.equal(configText, null);
  assert.deepEqual(keyFiles(box), []);
});

test('a setup cancelled over a config that was there leaves that config byte for byte', () => {
  const before = JSON.stringify({ version: 4, active_provider: 'openai', providers: { openai: { name: 'openai', auth_method: 'subscription', model: 'm' } }, channels: {} }, null, 2);
  const box = sandbox({ installFails: true, existingConfig: before });
  const { events, configText } = run(box, { select: { 'Config management': 'modify', 'AI Provider': 'glm' }, keys: [KEY], cancelAtConfirm: true });
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.equal(configText, before);
});

test('after a non-interactive setup with a key, jht doctor offers no migration and finds the key', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-doctor-key-'));
  const home = join(root, '.jht');
  mkdirSync(home, { recursive: true });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, JHT_HOME: home, JHT_DEPS_PREFIX: join(root, 'deps'), LANG: 'en_US.UTF-8', NO_COLOR: '1', JHT_LANG: 'en' };
  const entry = join(cli, 'bin/jht.js');
  const setup = spawnSync(process.execPath, [entry, 'setup', '--non-interactive', '--provider', 'glm', '--harness', 'pi', '--api-key-stdin', '--skip-health', '--language', 'en'],
    { env, input: `${KEY}\n`, encoding: 'utf8', timeout: 60_000 });
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  assert.equal(JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8')).version, 4);
  const doctor = spawnSync(process.execPath, [entry, 'doctor', '--all'], { env, encoding: 'utf8', timeout: 60_000 });
  const said = doctor.stdout + doctor.stderr;
  assert.doesNotMatch(said, /jht migrate|update available/, said);
  assert.doesNotMatch(said, /has no API key/, said);
  assert.match(said, /Provider: glm/, said);
  assert.equal(said.includes(KEY), false);
});

test('doctor says a key is missing when the reference leads to nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-doctor-nokey-'));
  const home = join(root, '.jht');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify({ version: 4, active_provider: 'glm', harness: 'pi',
    providers: { glm: { name: 'glm', auth_method: 'api_key', model: 'm', api_key_ref: { type: 'ref', source: 'file', path: join(root, 'absent.key') } } }, channels: {} }));
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, JHT_HOME: home, LANG: 'en_US.UTF-8', NO_COLOR: '1', JHT_LANG: 'en' };
  const doctor = spawnSync(process.execPath, [join(cli, 'bin/jht.js'), 'doctor', '--all'], { env, encoding: 'utf8', timeout: 60_000 });
  assert.match(doctor.stdout + doctor.stderr, /Provider glm has no API key/);
});

test('a setup cancelled over a key that was already stored puts that key back, and one cancelled at the question for the key stores nothing', () => {
  const box = sandbox({ installFails: true });
  mkdirSync(join(box.deps, 'keys'), { recursive: true, mode: 0o700 });
  writeFileSync(join(box.deps, 'keys', 'glm.key'), `${OTHER}\n`, { mode: 0o600 });
  const { events } = run(box, { select: { 'AI Provider': 'glm' }, keys: [KEY], cancelAtConfirm: true });
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.equal(readFileSync(join(box.deps, 'keys', 'glm.key'), 'utf8'), `${OTHER}\n`, 'the key that worked is still there');
});

test('a cancel that comes before the key store is written (at the key question) leaves no key file', () => {
  const box = sandbox();
  const driver = readFileSync(box.driver, 'utf8').replace("password: async (p) => {", "password: async (p) => { if (answers.cancelAtPassword) throw new WizardCancelledError();");
  writeFileSync(box.driver, driver);
  const { events } = run(box, { select: { 'AI Provider': 'kimi' }, cancelAtPassword: true });
  assert.equal(events.at(-1).kind, 'cancelled');
  assert.deepEqual(keyFiles(box), []);
});
