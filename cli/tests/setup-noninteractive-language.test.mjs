// `jht setup --non-interactive` says its lines in the language of the person (i18n-prefs.json, then JHT_LANG, then
// host.env), like the rest of the CLI: an Italian session got "Config saved!" and "API key kept by the setup".
// The key is invented and built from parts; the home is a temporary folder.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HOME = mkdtempSync(join(tmpdir(), 'jht-setup-language-'));
process.env.JHT_HOME = join(HOME, 'home');
process.env.JHT_DEPS_PREFIX = join(HOME, 'deps');
delete process.env.JHT_LANG;
mkdirSync(process.env.JHT_HOME);
const { runNonInteractiveSetup } = await import('../wizard/setup-noninteractive.js');
const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'locales');

const KEY = ['synthetic', 'glm', 'key', 'cd'.repeat(8)].join('-');

async function setup(opts, status = 200) {
  const out = [];
  const log = console.log; const error = console.error; const realFetch = globalThis.fetch;
  console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
  globalThis.fetch = async () => ({ status, ok: status >= 200 && status < 300 });
  process.exitCode = 0;
  const file = join(HOME, 'key.txt');
  writeFileSync(file, `${KEY}\n`, { mode: 0o600 });
  try { await runNonInteractiveSetup({ authMethod: 'api_key', harness: 'pi', provider: 'glm', apiKeyFile: file, ...opts }); }
  finally { console.log = log; console.error = error; globalThis.fetch = realFetch; }
  const code = process.exitCode; process.exitCode = 0;
  return { code, text: out.join('\n') };
}

test('a person who chose Italian reads the setup in Italian, from the title to the summary', async () => {
  writeFileSync(join(process.env.JHT_HOME, 'i18n-prefs.json'), '{"locale": "it"}\n');
  const { code, text } = await setup({});
  assert.equal(code, 0, text);
  for (const line of ['Setup di JHT — modalità non interattiva', 'la chiave API è accettata', 'Configurazione salvata!', 'Servizio:', 'chiave API tenuta dal setup (non nella configurazione)', 'Cartella di JHT:']) {
    assert.ok(text.includes(line), `${line}\n${text}`);
  }
  for (const line of ['Non-interactive mode', 'Config saved!', 'API key kept by the setup', 'the API key is accepted', 'JHT home:']) {
    assert.ok(!text.includes(line), `${line}\n${text}`);
  }
  assert.ok(!text.includes(KEY));
});

test('a person who chose English keeps the English lines, word for word', async () => {
  writeFileSync(join(process.env.JHT_HOME, 'i18n-prefs.json'), '{"locale": "en"}\n');
  const { code, text } = await setup({});
  assert.equal(code, 0, text);
  for (const line of ['JHT Setup — Non-interactive mode', 'GLM (Z.ai): the API key is accepted.', 'Config saved!', 'Provider:   ', 'Auth:       API key kept by the setup (not in the config)', 'JHT home:   ']) {
    assert.ok(text.includes(line), `${line}\n${text}`);
  }
});

test('the language given on the command line says the line that tells it in that language', async () => {
  writeFileSync(join(process.env.JHT_HOME, 'i18n-prefs.json'), '{"locale": "en"}\n');
  const { code, text } = await setup({ language: 'it', skipHealth: true });
  assert.equal(code, 0, text);
  assert.match(text, /Lingua: Italiano \(it\)/);
  assert.match(text, /Configurazione salvata!/);
});

test('every line of the setup has its English and its Italian in the catalogs', () => {
  const en = JSON.parse(readFileSync(join(LOCALES, 'en.json'), 'utf8'));
  const it = JSON.parse(readFileSync(join(LOCALES, 'it.json'), 'utf8'));
  const keys = Object.keys(en).filter((k) => k.startsWith('setup_ni.'));
  assert.ok(keys.length >= 10);
  for (const key of keys) {
    assert.equal(typeof it[key], 'string', key);
    assert.equal((en[key].match(/%s/g) || []).length, (it[key].match(/%s/g) || []).length, key);
  }
});
