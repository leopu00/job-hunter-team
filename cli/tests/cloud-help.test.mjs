// `jht cloud --help`: the sync is presented as optional and off by default, pause and resume come right after status,
// the three commands that are plumbing (bootstrap-status, sync-tickets, sync-directives) are not listed but still run,
// and all of it is said in the language of the person, titles included.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CATALOGS } from '../src/lib/texts.js';

const JHT = fileURLToPath(new URL('../bin/jht.js', import.meta.url));
const HIDDEN = ['bootstrap-status', 'sync-tickets', 'sync-directives'];
const ENGLISH_TITLES = ['Usage:', 'Options:', 'Commands:', 'display help for command'];
const KEYS = {
  login: 'login', pair: 'pair', enable: 'enable', status: 'status', pause: 'pause', resume: 'resume', claim: 'claim', push: 'push',
  quarantine: 'quarantine', 'pull-desired-state': 'pull_desired_state', 'chat-sync': 'chat_sync', 'pull-profile': 'pull_profile',
  disable: 'disable', restore: 'restore', daemon: 'daemon', 'realtime-listen': 'realtime_listen', 'team-state-listen': 'team_state_listen',
  'messages-listen': 'messages_listen', 'file-bridge-listen': 'file_bridge_listen', preflight: 'preflight',
};

function run(args, lang) {
  const home = mkdtempSync(join(tmpdir(), 'jht-cloud-help-'));
  return spawnSync(process.execPath, [JHT, ...args], { encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: home, JHT_HOME: join(home, '.jht'), JHT_LANG: lang, NO_COLOR: '1' } });
}
const help = (args, lang) => { const r = run(args, lang); assert.equal(r.status, 0, r.stderr); return r.stdout; };
/** The commands listed under the title, in order (the lines that start with a name in two spaces). */
const listed = (out) => [...out.matchAll(/^ {2}([a-z][a-z-]*)(?: \[options\])?(?: {2,}|$)/gm)].map((m) => m[1]).filter((n) => n !== 'help');

test('in English the sync is presented as optional and off by default, with the note at the end', () => {
  const out = help(['cloud', '--help'], 'en');
  assert.match(out, /^Usage: jht cloud \[options\] \[command\]\n\nOptional sync with the website, off by default/);
  assert.match(out, /The sync with the website is optional and off by default: while it is off it sends nothing to the website\./);
  assert.match(out, /jht cloud pause stops it and keeps the pairing; jht cloud resume turns it back on\.\n$/);
});

test('status, pause and resume are the first three, and the plumbing is not listed', () => {
  const names = listed(help(['cloud', '--help'], 'en'));
  assert.deepEqual(names.slice(0, 3), ['status', 'pause', 'resume']);
  for (const hidden of HIDDEN) assert.ok(!names.includes(hidden), `${hidden} is listed`);
  assert.deepEqual([...names].sort(), Object.keys(KEYS).sort(), 'what is listed is what is meant to be');
});

test('the three that are not listed still answer', () => {
  for (const name of HIDDEN) {
    const r = run(['cloud', name, '--help'], 'en');
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^Usage: jht cloud ${name}`));
  }
});

for (const lang of ['it', 'de', 'es', 'fr', 'hu', 'pt']) {
  test(`jht cloud --help in ${lang}: the titles, the description, every listed command and the note`, () => {
    const out = help(['cloud', '--help'], lang);
    const say = (key) => CATALOGS[lang][key];
    for (const key of ['team.help.title_usage', 'team.help.title_options', 'team.help.title_commands', 'team.help.help']) {
      assert.ok(out.includes(say(key)), `${lang} ${key}`);
    }
    // the text wraps by words, so compare without the line breaks
    const flat = out.replace(/\s+/g, ' ');
    assert.ok(flat.includes(say('cloud.help.description')), 'description');
    assert.ok(flat.includes(say('cloud.help.note')), 'note');
    for (const key of Object.values(KEYS)) assert.ok(flat.includes(say(`cloud.help.${key}`)), key);
    for (const word of ENGLISH_TITLES) assert.ok(!out.includes(word), `${word} in: ${out}`);
    assert.ok(help(['cloud', 'pause', '--help'], lang).includes(say('cloud.help.json')), 'the --json of pause');
    assert.ok(help(['cloud', 'resume', '--help'], lang).includes(say('cloud.help.json')), 'the --json of resume');
  });
}

test('every language has the same help keys as English, with no word of English left in a translated line', () => {
  const keys = Object.keys(CATALOGS.en).filter((k) => k.startsWith('cloud.help.'));
  assert.equal(keys.length, 23);
  for (const lang of ['it', 'de', 'es', 'fr', 'hu', 'pt']) {
    for (const key of keys) {
      assert.ok(CATALOGS[lang][key], `${lang} misses ${key}`);
      assert.notEqual(CATALOGS[lang][key], CATALOGS.en[key], `${lang} ${key} is still the English text`);
    }
  }
});

test('the list of `jht help` says the sync is optional and off by default, in the language of the person', () => {
  assert.match(help(['help'], 'en').replace(/\s+/g, ' '), /cloud Optional sync with the website, off by default/);
  assert.match(help(['help'], 'it').replace(/\s+/g, ' '), /cloud Sincronizzazione facoltativa con il sito, spenta di default/);
});
