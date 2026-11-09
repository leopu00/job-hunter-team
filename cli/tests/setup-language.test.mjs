import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// T304: `jht setup` asks or deduces the user's language and saves it in i18n-prefs.json, so the Assistant is not left in English.
const cli = fileURLToPath(new URL('..', import.meta.url));
const i18n = await import(join(cli, 'wizard/i18n.js'));
const { applyLanguage } = await import(join(cli, 'wizard/setup-noninteractive.js'));
const { askLanguage } = await import(join(cli, 'wizard/setup-language.js'));

const home = () => mkdtempSync(join(tmpdir(), 'jht-lang-'));
const prefs = (h) => JSON.parse(readFileSync(join(h, 'i18n-prefs.json'), 'utf8'));
const quiet = { log() {}, error() {} };

test('the system language is read from LC_ALL, then LC_MESSAGES, then LANG, and only the seven count', () => {
  assert.equal(i18n.systemLanguage({ LANG: 'it_IT.UTF-8' }), 'it');
  assert.equal(i18n.systemLanguage({ LC_ALL: 'de_DE.UTF-8', LANG: 'it_IT.UTF-8' }), 'de');
  assert.equal(i18n.systemLanguage({ LANG: 'C.UTF-8' }), null);
  assert.equal(i18n.systemLanguage({ LC_ALL: 'sv_SE.UTF-8', LANG: 'it_IT.UTF-8' }), null, 'a system language that is not ours is not replaced by another variable');
  assert.equal(i18n.systemLanguage({}), null);
});

test('saving a language keeps the other keys of the file, refuses a code that is not one of the seven and leaves no temporary file', () => {
  const h = home();
  writeFileSync(join(h, 'i18n-prefs.json'), JSON.stringify({ locale: 'en', extra: 1 }));
  i18n.saveLanguage('it', h);
  assert.deepEqual(prefs(h), { locale: 'it', extra: 1 });
  assert.throws(() => i18n.saveLanguage('xx', h), /Unknown language/);
  assert.deepEqual(readdirSync(h), ['i18n-prefs.json']);
  assert.equal(i18n.hasLanguageChoice(h), true);
  assert.equal(i18n.hasLanguageChoice(home()), false);
});

test('--language saves the language; an invalid one stops the setup and writes nothing', () => {
  const h = home();
  process.env.JHT_HOME = h;
  assert.equal(applyLanguage({ language: 'IT' }, quiet), true);
  assert.equal(prefs(h).locale, 'it');
  const h2 = home();
  process.env.JHT_HOME = h2;
  const errors = [];
  assert.equal(applyLanguage({ language: 'klingon' }, { log() {}, error: (m) => errors.push(m) }), false);
  assert.match(errors[0], /Invalid --language/);
  assert.equal(existsSync(join(h2, 'i18n-prefs.json')), false);
});

test('without --language the system language is used when nobody chose, and a language already chosen is not touched', () => {
  const h = home();
  process.env.JHT_HOME = h;
  assert.equal(applyLanguage({}, { ...quiet, env: { LANG: 'C.UTF-8' } }), true);
  assert.equal(existsSync(join(h, 'i18n-prefs.json')), false, 'a system that says nothing writes nothing');
  applyLanguage({}, { ...quiet, env: { LANG: 'fr_FR.UTF-8' } });
  assert.equal(prefs(h).locale, 'fr');
  applyLanguage({}, { ...quiet, env: { LANG: 'it_IT.UTF-8' } });
  assert.equal(prefs(h).locale, 'fr', 'the first choice stands');
});

test('the wizard asks the language, with the saved one (else the system one) as the default answer, and saves the answer', async () => {
  const asked = [];
  const prompter = { select: async (p) => { asked.push(p); return p.initialValue; }, note: async () => {} };
  const h = home();
  assert.equal(await askLanguage(prompter, { env: { LANG: 'es_ES.UTF-8' }, home: h }), 'es');
  assert.equal(asked[0].options.length, 7);
  assert.equal(prefs(h).locale, 'es');
  // a file written by the host setup with the default must not hide the question: it is asked, the saved language is the default
  const h2 = home();
  writeFileSync(join(h2, 'i18n-prefs.json'), JSON.stringify({ locale: 'de' }));
  process.env.JHT_HOME = h2;
  assert.equal(await askLanguage(prompter, { env: { LANG: 'es_ES.UTF-8' }, home: h2 }), 'de');
  assert.equal(asked.length, 2, 'asked again, Enter keeps the saved language');
  prompter.select = async () => 'it';
  assert.equal(await askLanguage(prompter, { env: {}, home: h2 }), 'it');
  assert.equal(prefs(h2).locale, 'it');
});

test('a language that cannot be saved does not stop the setup', async () => {
  const notes = [];
  const prompter = { select: async () => 'it', note: async (m) => notes.push(m) };
  await askLanguage(prompter, { env: {}, home: '/nonexistent/dir/for/jht' });
  assert.match(notes[0], /could not be saved/);
});

test('jht setup lists --language', () => {
  const h = home();
  const out = spawnSync(process.execPath, [join(cli, 'bin/jht.js'), 'setup', '--help'], { env: { PATH: dirname(process.execPath), HOME: h, JHT_HOME: h }, encoding: 'utf8' });
  assert.match(out.stdout, /--language <code>/);
});
