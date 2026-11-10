import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerCli } from '../src/commands/team/agents.js';
import { startRefusal } from '../src/commands/team/start.js';
import { harnessOf, harnessProblem, loginMarkerOf, usesPi, PI_IMAGE_BIN } from '../../shared/runtime/agent-harness.js';
import { piProgram, runPiLogin } from '../wizard/pi-login.js';
import { checkPi } from '../src/commands/providers-harness.js';

// The first setup lets the person choose the program that runs the agents (codex | pi): what is asked, what is
// installed and waited for, what the configuration says, and how `jht providers harness` and `team start` read it.
const cli = fileURLToPath(new URL('..', import.meta.url));
const entry = join(cli, 'bin/jht.js');

// What Pi writes after a sign-in, one entry per service (synthetic values): the ChatGPT account is `openai`, Anthropic's `anthropic`.
const OPENAI_LOGIN = '{"openai":{"type":"oauth","access":"synthetic"}}';
const ANTHROPIC_LOGIN = '{"anthropic":{"type":"oauth","access":"synthetic","refresh":"synthetic"}}';

function sandbox({ piLogsIn = true, piLogin = OPENAI_LOGIN } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-harness-'));
  const home = join(root, '.jht');
  const bin = join(root, 'bin');
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  const calls = join(root, 'calls.log');
  // a fake `jht` that records what the wizard asks of it, and a fake `pi` that logs in (or not) like /login does
  const fake = join(root, 'fake-jht.js');
  writeFileSync(fake, `require('node:fs').appendFileSync(${JSON.stringify(calls)}, 'jht ' + process.argv.slice(2).join(' ') + '\\n');\n`);
  const pi = join(bin, 'pi');
  writeFileSync(pi, `#!/bin/sh
echo "pi $* dir=$PI_CODING_AGENT_DIR" >> ${JSON.stringify(calls)}
${piLogsIn ? `mkdir -p "$PI_CODING_AGENT_DIR" && echo '${piLogin}' > "$PI_CODING_AGENT_DIR/auth.json"` : 'true'}
`);
  chmodSync(pi, 0o755);
  const driver = join(root, 'driver.mjs');
  writeFileSync(driver, `
import { runSetupWizard } from ${JSON.stringify(join(cli, 'wizard/setup.js'))};
const say = (kind, data) => console.log('EV ' + JSON.stringify({ kind, ...data }));
const answers = JSON.parse(process.env.WIZARD_ANSWERS || '{}');
const prompter = {
  intro: async () => {}, outro: async (message) => say('outro', { message }),
  note: async (message, title) => say('note', { message, title }),
  select: async (p) => { say('select', { message: p.message, options: p.options.map((o) => o.value), initial: p.initialValue }); return answers.harness ?? p.initialValue ?? p.options[0].value; },
  multiselect: async () => [], text: async () => '',
  confirm: async (p) => { say('confirm', { message: p.message }); return answers.confirm ?? p.initialValue ?? true; },
  progress: () => ({ update() {}, stop() {} }),
};
say('result', { ok: await runSetupWizard(prompter) });
`);
  return { root, home, bin, calls, fake, driver };
}

const env = (box, extra = {}) => ({
  PATH: `${box.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, JHT_HOME: box.home,
  JHT_NODE_ENTRY: box.fake, LANG: 'en_US.UTF-8', NO_COLOR: '1', ...extra,
});

function wizard(box, answers = {}) {
  const r = spawnSync(process.execPath, [box.driver], {
    env: env(box, { WIZARD_ANSWERS: JSON.stringify(answers) }), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  const events = r.stdout.split('\n').filter((l) => l.startsWith('EV ')).map((l) => JSON.parse(l.slice(3)));
  const calls = existsSync(box.calls) ? readFileSync(box.calls, 'utf8').trim().split('\n') : [];
  const config = existsSync(join(box.home, 'jht.config.json')) ? JSON.parse(readFileSync(join(box.home, 'jht.config.json'), 'utf8')) : null;
  return { r, events, calls, config };
}

test('the setup asks codex or pi, with codex as the default, and writes the answer', () => {
  const box = sandbox();
  mkdirSync(join(box.home, '.codex'), { recursive: true });
  writeFileSync(join(box.home, '.codex/auth.json'), '{}');
  const { r, events, calls, config } = wizard(box);
  assert.equal(r.status, 0, r.stderr);
  const ask = events.find((e) => e.kind === 'select' && /Program that runs the agents/.test(e.message));
  assert.ok(ask, 'the question is asked');
  assert.deepEqual(ask.options, ['codex', 'pi']);
  assert.equal(ask.initial, 'codex');
  assert.equal(config.harness, 'codex');
  assert.ok(calls.includes('jht providers update codex'));
  assert.equal(calls.some((c) => c.startsWith('pi ')), false, 'pi is not run');
  assert.equal(events.some((e) => /Plus or Pro/.test(e.message ?? '')), false, 'no word about pi for codex');
});

test('choosing pi: the note says what it needs, pi is installed, signed in by its own /login, and every agent will start on it', () => {
  const box = sandbox();
  const { r, events, calls, config } = wizard(box, { harness: 'pi' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(config.harness, 'pi');
  assert.equal(config.active_provider, 'openai');
  const note = events.find((e) => e.kind === 'note' && /Plus or Pro/.test(e.message));
  assert.ok(note, 'the subscription pi needs is said');
  assert.match(note.message, /jht providers harness codex/);
  // install pi (not codex), then the login of pi in the team's own folder, then the team starts
  const order = calls.map((c) => c.replace(/ dir=.*/, ''));
  assert.ok(order.indexOf('jht providers update pi') >= 0);
  assert.equal(order.includes('jht providers update codex'), false);
  assert.ok(order.indexOf('pi -nc -na -ns -ne --no-mcp') > order.indexOf('jht providers update pi'));
  assert.ok(order.indexOf('jht team start') > order.indexOf('pi -nc -na -ns -ne --no-mcp'));
  assert.match(calls.find((c) => c.startsWith('pi ')), new RegExp(`dir=${join(box.home, '.pi', 'agent').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.ok(events.some((e) => e.kind === 'note' && /Pi opens below\. What to do in it/.test(e.message) && /type \/login and choose OpenAI \(ChatGPT\)/.test(e.message)
    && /Ctrl\+C \(or type \/quit\)/.test(e.message)));
  // after it leaves, what it found: the provider, the entries and the model the team will use
  assert.ok(events.some((e) => e.kind === 'note' && /Pi sign-in found: OpenAI \(ChatGPT\) \(entries in the file: openai\)\. Model of the team: gpt-/.test(e.message)));
  assert.ok(events.some((e) => e.kind === 'note' && e.title === 'Configuration saved' && /Harness: {4}Pi/.test(e.message)));
  assert.equal(events.at(-1).ok, true);
});

test('a pi that exits without a login stops the setup before the team starts, and says it', () => {
  const box = sandbox({ piLogsIn: false });
  const { events, calls } = wizard(box, { harness: 'pi' });
  assert.equal(events.at(-1).ok, false);
  assert.ok(events.some((e) => e.kind === 'note' && /pi_login_missing: Pi exited, but its login was not found/.test(e.message)));
  assert.equal(calls.includes('jht team start'), false);
});

test('a pi login that is already there ends the step at once, and a kept configuration asks pi, not codex, for it', () => {
  const box = sandbox({ piLogsIn: false });
  mkdirSync(join(box.home, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(box.home, '.pi', 'agent', 'auth.json'), OPENAI_LOGIN);
  const first = wizard(box, { harness: 'pi' });
  assert.equal(first.events.at(-1).ok, true);
  assert.equal(first.calls.some((c) => c.startsWith('pi ')), false, 'pi is not started to sign in again');

  // second setup, keep: the question that decides what to wait for is the saved harness
  const keep = spawnSync(process.execPath, [box.driver], {
    env: env(box, { WIZARD_ANSWERS: JSON.stringify({ harness: 'keep' }) }), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  const events = keep.stdout.split('\n').filter((l) => l.startsWith('EV ')).map((l) => JSON.parse(l.slice(3)));
  assert.equal(events.at(-1).ok, true);
  assert.ok(events.some((e) => e.kind === 'note' && /Pi sign-in found: OpenAI \(ChatGPT\)/.test(e.message) && /auth\.json/.test(e.message)));
});

test('a pi login with only Anthropic is not the login of the OpenAI setup: said with what it holds, the team does not start, no «done»', () => {
  const box = sandbox({ piLogin: ANTHROPIC_LOGIN });
  const { events, calls } = wizard(box, { harness: 'pi' });
  assert.equal(events.at(-1).ok, false, 'the setup stops');
  const said = events.find((e) => e.kind === 'note' && /pi_login_wrong_provider/.test(e.message));
  assert.ok(said, 'the refusal has its code');
  assert.match(said.message, /not for OpenAI \(ChatGPT\): the file holds only: anthropic/);
  assert.match(said.message, /may be billed per token/);
  assert.equal(calls.includes('jht team start'), false, 'the team is not started on it');
  assert.equal(events.some((e) => e.kind === 'note' && e.title === 'Configuration saved'), false, '«Sign-in: done» is not said');
  assert.equal(events.some((e) => /All set/.test(e.message ?? '')), false);
  assert.equal(JSON.stringify(events).includes('synthetic'), false, 'no value of the file is shown');
});

test('a file that is there with only Anthropic is said before pi opens, and pi still opens so the right sign-in can be made', () => {
  const box = sandbox({ piLogsIn: false });
  mkdirSync(join(box.home, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(box.home, '.pi', 'agent', 'auth.json'), ANTHROPIC_LOGIN);
  const { events, calls } = wizard(box, { harness: 'pi' });
  const wrong = events.findIndex((e) => e.kind === 'note' && /is not for OpenAI \(ChatGPT\): the file holds only: anthropic/.test(e.message));
  const opens = events.findIndex((e) => e.kind === 'note' && /Pi opens below/.test(e.message));
  assert.ok(wrong >= 0 && opens > wrong, 'told first, then pi opens');
  assert.ok(calls.some((c) => c.startsWith('pi ')), 'pi was started to sign in again');
  assert.equal(events.at(-1).ok, false, 'and without the right sign-in the setup stops');
});

function jht(box, args) {
  const r = spawnSync(process.execPath, [entry, ...args], { env: env(box), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
  return { out: `${r.stdout}${r.stderr}`, status: r.status };
}

test('setup --non-interactive takes --harness, defaults to codex, and refuses an unknown one', () => {
  const box = sandbox();
  const base = ['setup', '--non-interactive', '--provider', 'openai', '--auth-method', 'subscription', '--subscription-email', 'user@example.com', '--skip-health'];
  assert.equal(jht(box, base).status, 0);
  assert.equal(JSON.parse(readFileSync(join(box.home, 'jht.config.json'), 'utf8')).harness, 'codex');
  const pi = jht(box, [...base, '--harness', 'pi']);
  assert.equal(pi.status, 0, pi.out);
  assert.equal(JSON.parse(readFileSync(join(box.home, 'jht.config.json'), 'utf8')).harness, 'pi');
  assert.match(pi.out, /Harness: {4}Pi/);
  assert.match(pi.out, /jht providers update pi/);
  const bad = jht(box, [...base, '--harness', 'opencode']);
  assert.equal(bad.status, 1);
  assert.match(bad.out, /Invalid harness "opencode"/);
  assert.equal(JSON.parse(readFileSync(join(box.home, 'jht.config.json'), 'utf8')).harness, 'pi', 'the refusal leaves the saved config as it was');
});

test('jht providers harness shows, changes and refuses', () => {
  const box = sandbox();
  const cfg = join(box.home, 'jht.config.json');
  assert.equal(jht(box, ['providers', 'harness', 'pi']).status, 1, 'no active provider yet');
  writeFileSync(cfg, JSON.stringify({ version: 1, active_provider: 'openai', providers: { openai: { name: 'openai', auth_method: 'subscription' } }, channels: {} }));
  assert.equal(jht(box, ['providers', 'harness']).out.trim(), 'codex');

  const set = jht(box, ['providers', 'harness', 'pi']);
  assert.equal(set.status, 0, set.out);
  assert.match(set.out, /codex → pi/);
  assert.match(set.out, /jht providers update pi/);
  assert.equal(JSON.parse(readFileSync(cfg, 'utf8')).harness, 'pi');
  assert.equal(jht(box, ['providers', 'harness']).out.trim(), 'pi');
  assert.match(jht(box, ['providers', 'harness', 'pi']).out, /already active/);

  assert.equal(jht(box, ['providers', 'harness', 'codex']).status, 0);
  assert.equal(JSON.parse(readFileSync(cfg, 'utf8')).harness, 'codex');
  const bad = jht(box, ['providers', 'harness', 'opencode']);
  assert.equal(bad.status, 1);
  assert.match(bad.out, /unrecognized/);
});

test('jht providers harness pi is refused for a provider pi cannot start on, and the config is not touched', () => {
  const box = sandbox();
  const cfg = join(box.home, 'jht.config.json');
  const text = JSON.stringify({ version: 1, active_provider: 'claude', providers: { claude: { name: 'claude', auth_method: 'subscription' } }, channels: {} });
  writeFileSync(cfg, text);
  const r = jht(box, ['providers', 'harness', 'pi']);
  assert.equal(r.status, 1);
  assert.match(r.out, /Claude subscription/);
  assert.equal(readFileSync(cfg, 'utf8'), text);
});

test('jht providers update pi checks the pi of the image by its own path, and installs nothing', () => {
  const calls = [];
  const out = [];
  const log = { log: (m) => out.push(m), error: (m) => out.push(m) };
  const before = process.exitCode;
  checkPi({ run: (cmd, args, opts) => { calls.push([cmd, args, opts.env.PI_TELEMETRY]); return { status: 0, stdout: '1.5.0\n' }; }, log });
  assert.deepEqual(calls, [[PI_IMAGE_BIN, ['--version'], '0']]);
  assert.match(out.join('\n'), /pi 1\.5\.0/);
  checkPi({ run: () => ({ error: new Error('ENOENT') }), log });
  assert.match(out.at(-1), /this image has no pi of its own/);
  assert.equal(process.exitCode, 1);
  process.exitCode = before;
  assert.doesNotMatch(readFileSync(join(cli, 'src/commands/providers-harness.js'), 'utf8'), /install-pi\.sh/, 'nothing is installed under the folder the agents can write');
  const r = jht(sandbox(), ['providers', 'update', 'nope']);
  assert.match(r.out, /Supported: codex/);
});

test('team start follows the harness: the CLI is pi, and a provider pi cannot start on stops before the team', () => {
  const openai = { active_provider: 'openai', providers: { openai: { auth_method: 'subscription' } } };
  assert.equal(providerCli({ ...openai, harness: 'pi' }), 'pi');
  assert.equal(providerCli({ ...openai, harness: 'codex' }), 'codex');
  assert.equal(providerCli(openai), 'codex');
  assert.equal(providerCli({ active_provider: 'claude', harness: 'pi' }), 'claude');

  assert.equal(startRefusal({ ...openai, harness: 'pi' }, { containerMode: true }), null);
  assert.match(startRefusal({ ...openai, harness: 'pi' }, { containerMode: false, hasTmux: () => true, hasCli: (b) => b !== 'pi' }), /the pi CLI of the active provider was not found/);
  const claude = { active_provider: 'claude', providers: { claude: { auth_method: 'subscription' } }, harness: 'pi' };
  assert.match(startRefusal(claude, { containerMode: true }), /Claude subscription.*jht providers harness codex/);
  assert.match(startRefusal({ ...openai, harness: 'opencode' }, { containerMode: true }), /harness must be one of: codex, pi/);
});

test('the login the boot and the watchdog wait for is the one of the program that drives the agents', () => {
  const openai = { active_provider: 'openai' };
  assert.equal(loginMarkerOf(openai), '.codex/auth.json');
  assert.equal(loginMarkerOf({ ...openai, harness: 'codex' }), '.codex/auth.json');
  assert.equal(loginMarkerOf({ ...openai, harness: 'pi' }), '.pi/agent/auth.json');
  assert.equal(loginMarkerOf({ active_provider: 'Codex', harness: 'pi' }), '.pi/agent/auth.json');
  assert.equal(loginMarkerOf({ active_provider: 'kimi' }), '.kimi/credentials/kimi-code.json');
  assert.equal(loginMarkerOf({ active_provider: 'claude', harness: 'pi' }), '.claude/.credentials.json', 'pi never starts there; the launcher says why');
  assert.equal(loginMarkerOf({ active_provider: 'unknown', harness: 'pi' }), null);
  assert.equal(loginMarkerOf(null), null);
});

test('the harness of a config: absent is codex, an unknown value is not a harness, and each refusal says why', () => {
  assert.equal(harnessOf({}), 'codex');
  assert.equal(harnessOf({ harness: 'pi' }), 'pi');
  assert.equal(harnessOf({ harness: 'opencode' }), null);
  assert.equal(usesPi({ active_provider: 'openai', harness: 'pi' }), true);
  assert.equal(usesPi({ active_provider: 'kimi', harness: 'pi' }), true);
  assert.equal(usesPi({ active_provider: 'glm', harness: 'pi' }), true);
  assert.equal(usesPi({ active_provider: 'glm', harness: 'codex' }), false);
  assert.equal(harnessProblem('pi', 'openai', 'subscription'), null);
  assert.equal(harnessProblem('codex', 'kimi', 'api_key'), null);
  // GLM has no CLI of its own: Codex cannot run it (Kimi keeps its legacy CLI under the default harness)
  assert.match(harnessProblem('codex', 'glm', 'api_key'), /GLM \(Z\.ai\) runs only on the pi harness/);
  assert.equal(harnessProblem('codex', 'openai', 'subscription'), null);
  assert.match(harnessProblem('pi', 'claude', 'subscription'), /Claude subscription.*per token/);
  assert.match(harnessProblem('pi', 'claude', 'api_key'), /only active_provider=openai/);
  assert.match(harnessProblem('pi', 'kimi', 'subscription'), /only with an API key/);
  assert.match(harnessProblem('pi', 'glm', 'subscription'), /only with an API key/);
  assert.equal(harnessProblem('pi', 'glm', 'api_key'), null);
  assert.equal(harnessProblem('pi', 'moonshot', 'api_key'), null);
  assert.match(harnessProblem('pi', 'gemini', 'api_key'), /only active_provider=openai, glm or kimi/);
  assert.match(harnessProblem('x', 'openai'), /one of: codex, pi/);
});

test('the sign-in runs the pi of the image by its own path, and the name only when the image has none', () => {
  assert.equal(PI_IMAGE_BIN, '/opt/jht-pi/bin/pi');
  assert.equal(piProgram(() => true), PI_IMAGE_BIN);
  assert.equal(piProgram(() => false), 'pi');
  const seen = [];
  const stdin = { isRaw: false, isPaused: () => true, pause() {}, resume() {}, isTTY: false };
  runPiLogin({ spawn: (cmd, args) => { seen.push([cmd, args]); return { status: 0 }; }, stdin, env: { PATH: '/opt/jht-deps/bin' }, exists: () => true });
  assert.equal(seen[0][0], PI_IMAGE_BIN, 'not a pi from the folder the agents can write');
});

test('the boot gate reads the login of Pi only when it is a regular file of a sane size, and only then looks at the entry names', () => {
  const pid1 = readFileSync(join(cli, 'src/commands/pid1.js'), 'utf-8');
  const check = pid1.split('async function hasProviderCredentials()')[1].split('\n}\n')[0];
  const guard = check.indexOf('lstat(marker)');
  assert.ok(guard > 0 && guard < check.indexOf('readFile(marker'), 'lstat comes before the read');
  assert.match(check, /!info\.isFile\(\) \|\| info\.size <= 0 \|\| info\.size > 256 \* 1024/);
  assert.match(check, /inspectPiLogin\(/);
});
