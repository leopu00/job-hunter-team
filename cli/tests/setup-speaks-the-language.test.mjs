// `jht setup` walked through in Portuguese and German, as after an update: a configuration already there, «update the values»,
// a provider with an API key, the budget, the check of pi [1/3], the team stopped and started [3/3] (the real `jht team stop` and
// `jht team start`, on a container that a fake docker stands for), a budget pause, the summary; on a VPS too (web account and
// Telegram). Every answer, key and answer of the provider is synthetic. The test fails on any line of the English catalogs (the
// wizard's and the CLI's) and on the English words that used to be written in the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { offeredInRelease } from '../../shared/runtime/release-providers.js';
import { CATALOGS } from '../src/lib/texts.js';

const cli = fileURLToPath(new URL('..', import.meta.url));
const locales = fileURLToPath(new URL('../../shared/locales/', import.meta.url));
const catalog = (lang) => JSON.parse(readFileSync(join(locales, `${lang}.json`), 'utf8'));
const KEY = ['synthetic', 'key', '0123456789', 'abcdef'].join('-'); // built, so that no scanner reads it as a key
const PROVIDER = ['claude', 'glm', 'kimi', 'openai'].find((p) => offeredInRelease(p));

// the English words the code used to write itself, whatever the language
const WRITTEN_IN_THE_CODE = [
  /^Provider:/m, /^Harness:/m, /^Auth:/m, /Models by role/, /^Sign-in:/m, /^Config:/m, /^JHT home:/m, /Configuration saved/,
  /Empty configuration/, /bots configured/, /Telegram: incomplete/, /did not complete/, /was not found here/, /could not be started/,
  /ended with code/, /Setup cancelled/, /Telegram pairing runs on the host/, /Optional Telegram/, /Show the host commands/,
  /coming in a later release/, /Paste the/, /\bAPI key\b/, /More details/, /Checking pi/, /comes with the image/, /Starting agents/,
  /already active/, /not yet active/, /Team already running/, /^\s*Result:/m, /Mode:/, /Stopping agents/, /agents stopped/,
  /\bstarted\b/, /\bstopped\b/, /The team is paused/, /not applied/,
];

/** The English lines of the wizard's catalog (and the pieces of its templates) that the language has words of its own for. */
function englishLines(lang) {
  const en = catalog('en');
  const own = catalog(lang);
  const ownText = Object.entries(own).filter(([k]) => k.startsWith('wizard.')).map(([, v]) => v).join('\n');
  const lines = new Set();
  for (const [key, text] of Object.entries(en)) {
    if (!key.startsWith('wizard.') || typeof text !== 'string' || own[key] === text) continue;
    for (const line of text.split('\n')) {
      for (const piece of line.split(/%[sd]/)) {
        const words = piece.trim();
        // a command, a path or a name is the same in every language: only English words count
        if (words.length >= 14 && /[a-z]{3,} [a-z]{3,}/.test(words) && !ownText.includes(words)) lines.add(words);
      }
    }
  }
  // the CLI's catalog: the texts the language has (a PARTIAL one says the rest in English, outside the setup)
  const cliOwn = CATALOGS[lang] ?? {};
  const cliOwnText = Object.values(cliOwn).join('\n');
  for (const [key, text] of Object.entries(CATALOGS.en)) {
    if (!(key in cliOwn) || cliOwn[key] === text) continue;
    for (const piece of text.split(/\{\w+\}/)) {
      const words = piece.trim();
      if (words.length >= 14 && /[a-z]{3,} [a-z]{3,}/.test(words) && !cliOwnText.includes(words) && !ownText.includes(words)) lines.add(words);
    }
  }
  return [...lines];
}

function sandbox(lang) {
  const root = mkdtempSync(join(tmpdir(), `jht-setup-${lang}-`));
  const home = join(root, '.jht');
  const deps = join(root, 'deps');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  // the language the person chose at the install, and a team set up before the update
  writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale: lang }));
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify({
    version: 4, active_provider: 'glm', harness: 'pi',
    providers: { glm: { name: 'glm', auth_method: 'api_key', api_key_ref: { type: 'ref', source: 'file', path: join(deps, 'keys', 'glm.key') } } },
    channels: { telegram: { bots: { assistente: { bot_token: 'synthetic' } } } },
  }));
  // the budget of the team was paused at the end of its period, BEFORE this setup saved a new budget: the pause of the old
  // budget is not said after the setup (cli/src/lib/budget-pause.js), in no language
  mkdirSync(join(home, 'logs'), { recursive: true });
  writeFileSync(join(home, 'logs', 'daily-halt.flag'), JSON.stringify({ reason: 'pi_spend_cap',
    pi_spend_cap: { why: 'period', spent: 3.1, ceiling: 5, budget_usd: 5, ends_at: '2026-11-16T08:00:00+01:00' } }));
  // the program of the steps: pi checked by the real check (a pi that answers), the team stopped and started by the real
  // commands; the web account and anything else end at once
  const fake = join(root, 'fake-jht.mjs');
  writeFileSync(fake, `
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.join(' ') === 'providers update pi') {
  const { checkPi } = await import(${JSON.stringify(join(cli, 'src/commands/providers-harness.js'))});
  checkPi({ run: () => ({ status: 0, stdout: '0.70.0' }) });
} else if (args[0] === 'team') {
  const r = spawnSync(process.execPath, [${JSON.stringify(join(cli, 'bin/jht.js'))}, ...args], { stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--import ' + ${JSON.stringify(join(root, 'fake-statfs.mjs'))} } });
  process.exit(r.status ?? 1);
}
`);
  // a disk with room: the start refuses under 3% free, and the free space is the machine's, not the code's
  writeFileSync(join(root, 'fake-statfs.mjs'), `import fs from 'node:fs';
fs.statfsSync = () => ({ bsize: 4096, blocks: 1000000, bfree: 500000, bavail: 500000 });
`);
  // the container jht: the sessions in FAKE_SESSIONS, the Mentor waiting for the first scores, every start and stop working
  const docker = join(bin, 'docker');
  writeFileSync(docker, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('Docker version fake'); process.exit(0); }
if (args[0] === 'ps') { console.log('jht'); process.exit(0); }
if (args[0] !== 'exec') process.exit(0);
const command = args.slice(args.indexOf('jht') + 1);
const line = command.join(' ');
if (line.includes('first_run.py mentor-due')) process.exit(1);
if (command[0] === 'bash' && command[1] === '-c' && command[2].includes('tmux list-sessions')) {
  if (process.env.FAKE_SESSIONS) console.log(process.env.FAKE_SESSIONS.split(',').join('\\n'));
}
process.exit(0);
`);
  chmodSync(docker, 0o755);
  const pi = join(bin, 'pi');
  writeFileSync(pi, '#!/bin/sh\ntrue\n');
  chmodSync(pi, 0o755);
  const driver = join(root, 'driver.mjs');
  writeFileSync(driver, `
globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => '' });
const { runSetupWizard, describeStepFailure } = await import(${JSON.stringify(join(cli, 'wizard/setup.js'))});
const { summarizeExistingConfig } = await import(${JSON.stringify(join(cli, 'wizard/setup-helpers.js'))});
const say = (kind, text) => console.log('EV ' + JSON.stringify({ kind, text }));
const answers = JSON.parse(process.env.WIZARD_ANSWERS);
const prompter = {
  intro: async (title) => say('intro', title), outro: async (message) => say('outro', message),
  note: async (message, title) => say('note', [title, message].join('\\n')),
  select: async (p) => { say('select', [p.message, ...p.options.map((o) => o.label)].join('\\n'));
    return p.options.find((o) => answers.prefer.includes(o.value))?.value ?? p.initialValue ?? p.options[0].value; },
  multiselect: async () => [], text: async (p) => { say('text', p.message); return ''; },
  password: async (p) => { say('password', [p.message, p.validate?.('') ?? '', p.validate?.('short') ?? ''].join('\\n')); return ${JSON.stringify(KEY)}; },
  confirm: async (p) => { say('confirm', [p.message, p.active ?? '', p.inactive ?? ''].join('\\n')); return answers.confirm; },
  progress: (label) => { say('progress', label); return { update() {}, stop: (m) => say('progress', m ?? '') }; },
};
say('result', String(await runSetupWizard(prompter)));
// the lines a setup says only when something goes wrong, and the other summaries of a configuration
for (const why of [{ missing: true }, { status: null }, { status: 3 }]) say('failure', describeStepFailure('team start', why));
say('summary', summarizeExistingConfig({}));
say('summary', summarizeExistingConfig({ active_provider: 'openai', harness: 'pi', providers: { openai: { auth_method: 'subscription' } },
  channels: { telegram: { bots: { assistente: { bot_token: 'a' }, capitano: { bot_token: 'b' }, mentor: { bot_token: 'c' } } } } }));
say('summary', summarizeExistingConfig({ active_provider: 'openai', providers: { openai: { auth_method: 'cli' } }, team: { role_models: { scout: { model: 'wrong' } } } }));
`);
  return { root, home, deps, bin, fake, driver };
}

function walk(lang, { confirm, sessions = '' }) {
  const box = sandbox(lang);
  const r = spawnSync(process.execPath, [box.driver], {
    env: { PATH: `${box.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, JHT_HOME: box.home, JHT_DEPS_PREFIX: box.deps,
      JHT_NODE_ENTRY: box.fake, JHT_HOST_TYPE: 'vps', LANG: 'en_US.UTF-8', NO_COLOR: '1', JHT_CONTAINER_NAME: 'jht', FAKE_SESSIONS: sessions,
      WIZARD_ANSWERS: JSON.stringify({ prefer: ['modify', PROVIDER, 'api_key'], confirm }) },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  const events = r.stdout.split('\n').filter((l) => l.startsWith('EV ')).map((l) => JSON.parse(l.slice(3)));
  // everything the person sees: what the prompter shows and what the setup prints between the questions
  const seen = [...events.map((e) => e.text), ...`${r.stdout}\n${r.stderr}`.split('\n').filter((l) => l && !l.startsWith('EV '))].join('\n');
  return { r, events, seen };
}

const RUNNING = 'ASSISTENTE,SENTINELLA,CAPITANO';
for (const [lang, confirm, sessions] of [['pt', true, RUNNING], ['de', false, ''], ['pt', false, ''], ['de', true, RUNNING]]) {
  test(`jht setup in ${lang} after an update (${confirm ? 'Telegram commands shown' : 'Telegram skipped'}, ${sessions ? 'team running' : 'team off'}): no line of English`, { skip: PROVIDER ? false : 'no provider with a key in this release' }, () => {
    const { r, events, seen } = walk(lang, { confirm, sessions });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(events.find((e) => e.kind === 'result')?.text, 'true', seen);
    // the walk went through the parts that were English: the configuration there, the key, the summary at the end
    const own = catalog(lang);
    assert.ok(seen.includes(own['wizard.config_existing_title']), 'the configuration already there is shown');
    assert.ok(seen.includes(own['wizard.key.title']), 'the key is asked');
    assert.ok(seen.includes(own['wizard.summary.saved_title']), 'the summary at the end is shown');
    assert.ok(seen.includes(own[confirm ? 'wizard.telegram.pair_title' : 'wizard.telegram.skipped_title']), 'the Telegram step is shown');
    assert.ok(seen.includes(own['wizard.summary.models_by_role']), 'the models of each role are listed');
    // the steps after the questions: pi checked, the team stopped (another service) and started; the old pause not said
    const cliOwn = CATALOGS[lang];
    for (const key of ['pi.checking', sessions ? 'stop.stopping' : 'stop.none_active', 'team.mentor_waits', sessions ? 'team.already_running' : 'team.starting_container']) {
      assert.ok(seen.includes(cliOwn[key]), `${key} is said`);
    }
    assert.doesNotMatch(seen, new RegExp(cliOwn['budget.paused_period'].slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const english = englishLines(lang).filter((line) => seen.includes(line));
    assert.deepEqual(english, [], `${lang}: lines left in English`);
    const written = WRITTEN_IN_THE_CODE.filter((re) => re.test(seen)).map(String);
    assert.deepEqual(written, [], `${lang}: English words written in the code`);
    assert.equal(seen.includes(KEY), false, 'the key is never shown');
  });
}

test('the check would see English: the same walk in English trips it', { skip: PROVIDER ? false : 'no provider with a key in this release' }, () => {
  const { r, seen } = walk('en', { confirm: true, sessions: RUNNING });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(englishLines('pt').some((line) => seen.includes(line)));
  assert.ok(WRITTEN_IN_THE_CODE.filter((re) => re.test(seen)).length >= 10);
});

test('jht team chat (the header, the question cards, the answers, its own lines) is said in every language, with the same commands', () => {
  const chatKeys = Object.keys(CATALOGS.en).filter((key) => key.startsWith('chat.'));
  assert.ok(chatKeys.includes('chat.card.question') && chatKeys.includes('chat.card.answer_number'));
  for (const [lang, catalog] of Object.entries(CATALOGS)) {
    if (lang === 'en') continue;
    for (const key of chatKeys) assert.ok(catalog[key], `${lang} has ${key}`);
    assert.notEqual(catalog['chat.header.commands'], CATALOGS.en['chat.header.commands'], lang);
    const commands = (text) => text.match(/\/[a-z]+/g);
    assert.deepEqual(commands(catalog['chat.header.commands']), commands(CATALOGS.en['chat.header.commands']), lang);
  }
});

test('a question card in German: no English word around the code and the options', async () => {
  const { formatCard } = await import('../src/commands/team/chat.js');
  const card = formatCard({ code: 'Q0612', subject: 'Synthetic subject', text: 'Synthetic text?', options: ['eins', 'zwei'] }, 'de')
    .replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(card, /^Frage Q0612/);
  assert.match(card, /Antworte mit der Nummer/);
  assert.doesNotMatch(card, /question|Answer with/);
});

test('jht team status of a team paused on its budget, in German: the sessions are counted paused, not running, with no English word', () => {
  const home = mkdtempSync(join(tmpdir(), 'jht-status-de-'));
  writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale: 'de' }));
  const script = `
const { renderObservation } = await import(${JSON.stringify(join(cli, 'src/lib/agent-observation-view.js'))});
const agents = ['capitano', 'scout-1'].map((id) => ({ id, session: id.toUpperCase(), running: true, state: 'avviato_mai_partito', identity: {}, usage: { tokens: null } }));
const snapshot = { ok: true, running: 2, total: 2, agents, errors: [], usage: {} };
for (const paused of [true, false]) console.log(renderObservation(snapshot, { usage: false, paused, width: 200 }));
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env.PATH, HOME: home, JHT_HOME: home, NO_COLOR: '1' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const [paused, running] = r.stdout.split(/(?=^\s*Agenten · )/m).filter((part) => part.trim());
  assert.match(paused, /2 von 2 pausiert \(Budget\)/);
  assert.match(paused, /CAPITANO\s+pausiert/);
  assert.match(running, /2 von 2 aktiv/);
  assert.match(running, /noch kein Durchgang aufgezeichnet/);
  assert.doesNotMatch(r.stdout, /running|no turn recorded|Agents|State|paused\b/);
});
