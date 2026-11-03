import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOGS, resolveLanguage } from '../src/lib/texts.js';

// The language of the screens: where it comes from, that every language has the same texts, and that the
// screens come out in it while the machine output does not change.
const src = fileURLToPath(new URL('../src', import.meta.url));
const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

function home(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-lang-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test('the language comes from JHT_LANG, then the app, then the configuration, then the system, then English', () => {
  const none = home();
  assert.equal(resolveLanguage({}, none), 'en');
  assert.equal(resolveLanguage({ LANG: 'it_IT.UTF-8' }, none), 'it');
  assert.equal(resolveLanguage({ LC_ALL: 'de_DE.UTF-8', LANG: 'it_IT.UTF-8' }, none), 'de');
  assert.equal(resolveLanguage({ LANG: 'C.UTF-8' }, none), 'en');
  assert.equal(resolveLanguage({ LANG: 'ja_JP.UTF-8' }, none), 'en');
  assert.equal(resolveLanguage({ LC_ALL: 'C.UTF-8', LANG: 'it_IT.UTF-8' }, none), 'en', 'LC_ALL=C overrides LANG, as for the system');
  const config = home({ 'jht.config.json': JSON.stringify({ language: 'fr' }) });
  assert.equal(resolveLanguage({ LANG: 'it_IT.UTF-8' }, config), 'fr');
  const app = home({ 'jht.config.json': JSON.stringify({ language: 'fr' }), 'i18n-prefs.json': JSON.stringify({ locale: 'es' }) });
  assert.equal(resolveLanguage({ LANG: 'it_IT.UTF-8' }, app), 'es');
  assert.equal(resolveLanguage({ JHT_LANG: 'pt', LANG: 'it_IT.UTF-8' }, app), 'pt');
  assert.equal(resolveLanguage({ JHT_LANG: 'xx', LANG: 'it_IT.UTF-8' }, none), 'it', 'a language that does not exist is ignored');
});

test('every language has the same texts as English, with the same {words} to fill in', () => {
  const words = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [lang, catalog] of Object.entries(CATALOGS)) {
    if (lang === 'en') continue;
    for (const key of Object.keys(CATALOGS.en)) {
      assert.ok(key in catalog, `${lang} misses ${key}`);
      assert.equal(words(catalog[key]), words(CATALOGS.en[key]), `${lang} ${key}: the {words} differ`);
    }
    for (const key of Object.keys(catalog)) {
      // the descriptions of the commands in the list of `jht help` are only where the language has them
      assert.ok(key in CATALOGS.en || key.startsWith('cmd.'), `${lang} has ${key} which English has not`);
    }
  }
});

test('every text a screen asks for exists, and every text of the catalog is used', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'texts') walk(path); } else if (name.endsWith('.js')) files.push(path);
    }
  };
  walk(src);
  const used = new Set();
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:say|later)\('([\w.]+)'/g)) used.add(m[1]);
  }
  for (const key of used) assert.ok(key in CATALOGS.en, `${key} is asked for and English has no such text`);
  // keys built from a name (cmd.<name>, help groups, host commands, the plural forms) are used through a table
  const indirect = /^(cmd\.|error\.|help\.(group_|host_)|doctor\.(warning|problem)_|doctor\.sec_)/;
  for (const key of Object.keys(CATALOGS.en)) {
    assert.ok(used.has(key) || indirect.test(key), `${key} is in the catalog and no screen asks for it`);
  }
});

function jht(args, box, env = {}) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, JHT_HOME: box.home, ...env },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  });
  return { out: `${result.stdout}${result.stderr}`, status: result.status };
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'jht-lang-box-'));
  const home = join(root, '.jht');
  mkdirSync(home, { recursive: true });
  return { root, home };
}

test('the every-day screens come out in the language of the person, and in English where it has no texts yet', () => {
  const box = sandbox();
  const it = { JHT_LANG: 'it' };
  assert.match(jht(['status'], box, it).out, /Stato[\s\S]*Configurazione\s+non trovata[\s\S]*Configurala con: jht setup/);
  assert.match(jht(['agents'], box, it).out, /Agenti[\s\S]*Agente\s+Sessione\s+Stato[\s\S]*spento/);
  assert.match(jht(['doctor'], box, it).out, /Controllo ·/);
  assert.match(jht(['help'], box, it).out, /Ogni giorno:[\s\S]*La tua squadra:[\s\S]*Aiuto su un comando/);
  // a language with no texts yet is English, not half of one
  const german = jht(['status'], box, { JHT_LANG: 'de' }).out;
  assert.match(german, /Status[\s\S]*Configuration\s+not found/);
  // the system's language is followed when nothing else is said
  assert.match(jht(['status'], box, { LANG: 'it_IT.UTF-8' }).out, /Configurazione/);
  assert.match(jht(['status'], box, { LANG: 'en_US.UTF-8' }).out, /Configuration/);
});

test('--json is the same in every language', () => {
  const box = sandbox();
  for (const command of [['status', '--json'], ['agents', '--json'], ['doctor', '--json']]) {
    const normalize = (out) => out.replace(/"message": ".*"/g, '"message": "-"').replace(/"section": ".*"/g, '"section": "-"');
    assert.equal(normalize(jht(command, box, { JHT_LANG: 'it' }).out), normalize(jht(command, box, { JHT_LANG: 'en' }).out), command.join(' '));
  }
});
