import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `jht setup` as a person goes through it, with a prompter that answers the default and a program that stands for
// the rest of jht: what is asked, in which order the steps are numbered, and when the configuration is called saved.
const cli = fileURLToPath(new URL('..', import.meta.url));
const entry = join(cli, 'bin/jht.js');

function sandbox({ providerInstallFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-wizard-'));
  const home = join(root, '.jht');
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex/auth.json'), '{}');
  const fake = join(root, 'fake-jht.js');
  writeFileSync(fake, `process.exit(${providerInstallFails ? "process.argv[2] === 'providers' ? 1 : 0" : '0'});\n`);
  const harness = join(root, 'harness.mjs');
  writeFileSync(harness, `
import { runSetupWizard } from ${JSON.stringify(join(cli, 'wizard/setup.js'))};
const say = (kind, data) => console.log('EV ' + JSON.stringify({ kind, ...data }));
const answers = JSON.parse(process.env.WIZARD_ANSWERS || '{}');
const prompter = {
  intro: async (title) => say('intro', { title }),
  outro: async (message) => say('outro', { message }),
  note: async (message, title) => say('note', { message, title }),
  select: async (p) => { say('select', { message: p.message }); return p.initialValue ?? p.options[0].value; },
  multiselect: async () => [],
  text: async () => '',
  confirm: async (p) => { say('confirm', { message: p.message, active: p.active, inactive: p.inactive }); return answers.confirm ?? p.initialValue ?? true; },
  progress: (label) => { say('progress', { label }); return { update() {}, stop: (m) => say('progress-stop', { message: m }) }; },
};
say('result', { ok: await runSetupWizard(prompter) });
`);
  return { root, home, fake, harness };
}

function run(box, answers = {}) {
  const result = spawnSync(process.execPath, [box.harness], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, JHT_HOME: box.home, JHT_NODE_ENTRY: box.fake, LANG: 'en_US.UTF-8', WIZARD_ANSWERS: JSON.stringify(answers), NO_COLOR: '1' },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  const lines = result.stdout.split('\n').filter(Boolean);
  const events = lines.filter((l) => l.startsWith('EV ')).map((l) => JSON.parse(l.slice(3)));
  return { result, lines, events };
}

test('the setup says the provider instead of asking for the only one offered, numbers the slow steps, and calls the configuration saved only at the end', () => {
  const box = sandbox();
  const { result, lines, events } = run(box);
  assert.equal(result.status, 0, result.stderr);
  // one title, and no question with a single answer
  assert.equal(events.filter((e) => e.kind === 'intro').length, 1);
  assert.equal(events.some((e) => e.kind === 'select' && /provider/i.test(e.message)), false);
  assert.ok(events.some((e) => e.kind === 'note' && e.title === 'AI Provider' && /Codex/.test(e.message)));
  // nothing is called saved before the steps that can still fail
  const savedAt = events.findIndex((e) => /saved/i.test(`${e.title ?? ''} ${e.message ?? ''}`) && e.kind !== 'outro');
  const stepLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^\[\d\/3\]/.test(l));
  assert.deepEqual(stepLines.map(({ l }) => l.slice(0, 5)), ['[1/3]', '[2/3]', '[3/3]']);
  assert.equal(events.some((e) => e.kind === 'progress-stop' && /saved/i.test(e.message ?? '')), false);
  const savedLine = lines.findIndex((l) => l.startsWith('EV ') && /Configuration saved/.test(l));
  assert.ok(savedLine > stepLines.at(-1).i, 'the summary comes after the last step');
  assert.ok(savedAt > -1);
  assert.equal(events.at(-1).kind, 'result');
  assert.equal(events.at(-1).ok, true);
  assert.equal(events.at(-2).kind, 'outro');
  assert.match(readFileSync(join(box.home, 'jht.config.json'), 'utf8'), /"active_provider": "openai"/);
});

test('when the provider program cannot be installed the question says what each answer does, and stopping does not call anything saved', () => {
  const box = sandbox({ providerInstallFails: true });
  const { events } = run(box, { confirm: false });
  const ask = events.find((e) => e.kind === 'confirm' && /could not be installed/.test(e.message));
  assert.ok(ask, 'the question is asked');
  assert.match(ask.active, /^Yes, continue/);
  assert.match(ask.inactive, /^No, stop here/);
  assert.match(ask.message, /jht providers update codex/);
  assert.match(ask.message, /jht setup starts again/);
  assert.equal(events.some((e) => /Configuration saved/.test(e.title ?? '')), false);
  assert.match(events.at(-2).message, /Setup aborted/);
  // a setup that stopped says so to the code that called it: the command leaves exit 1
  assert.equal(events.at(-1).ok, false);
});

test('the wizard draws no box and no cyan: the banner is gone, the title is one bold line', () => {
  for (const file of ['wizard/index.js', 'src/commands/setup.js', 'wizard/clack-prompter.js', 'wizard/setup-noninteractive.js']) {
    const source = readFileSync(join(cli, file), 'utf8');
    assert.equal(/cyan|bgCyan|╔|╚|printBanner/.test(source), false, file);
  }
});

function setupNonInteractive(args, box) {
  const result = spawnSync(process.execPath, [entry, 'setup', '--non-interactive', '--provider', 'openai', '--skip-health', ...args], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, JHT_HOME: box.home, LANG: 'en_US.UTF-8' },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  });
  return { out: `${result.stdout}${result.stderr}`, status: result.status };
}

test('--api-key-file reads the key from a file, so it is not on the command line; an empty or missing file is said, and nothing is written', () => {
  const box = sandbox();
  const keyFile = join(box.root, 'key.txt');
  // a made-up value that is plainly not a key (a run of one letter), so no scanner takes it for one
  const fake = `sk-${'a'.repeat(30)}`;
  writeFileSync(keyFile, `${fake}\n`);
  const ok = setupNonInteractive(['--api-key-file', keyFile], box);
  assert.equal(ok.status ?? 0, 0, ok.out);
  const config = JSON.parse(readFileSync(join(box.home, 'jht.config.json'), 'utf8'));
  assert.equal(config.providers.openai.api_key, fake);
  assert.equal((statSync(join(box.home, 'jht.config.json')).mode & 0o077), 0, 'the file holding a key is private');

  const empty = sandbox();
  writeFileSync(join(empty.root, 'empty.txt'), '\n');
  const blank = setupNonInteractive(['--api-key-file', join(empty.root, 'empty.txt')], empty);
  assert.notEqual(blank.status, 0);
  assert.match(blank.out, /is empty/);
  const missing = setupNonInteractive(['--api-key-file', join(empty.root, 'nope.txt')], empty);
  assert.notEqual(missing.status, 0);
  assert.match(missing.out, /cannot be read/);
  assert.equal(readdirSync(empty.home).includes('jht.config.json'), false);
});

test('the help of setup warns that --api-key is visible and offers --api-key-file', () => {
  const box = sandbox();
  const help = spawnSync(process.execPath, [entry, 'setup', '--help'], { env: { PATH: dirname(process.execPath), HOME: box.root, JHT_HOME: box.home }, encoding: 'utf8' });
  assert.match(help.stdout, /--api-key-file <path>/);
  assert.match(help.stdout.replace(/\s+/g, ' '), /prefer --api-key-file/);
});
