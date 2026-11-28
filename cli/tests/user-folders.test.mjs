// JHT-T360: the folders the person sees on their computer have the name of their language, from one catalog; inside the
// container the paths stay the internal ones. The Assistente never names a folder that is not on the disk.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const roots = [];
function temporary(prefix) {
  const root = mkdtempSync(prefix);
  roots.push(root);
  return root;
}
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
process.env.JHT_HOME = temporary(join(tmpdir(), 'jht-user-folders-'));
const lib = await import('../src/lib/user-folders.js');
const catalog = JSON.parse(readFileSync(new URL('../../shared/i18n/role-names.json', import.meta.url), 'utf8'));
const LANGS = ['it', 'en', 'de', 'fr', 'es', 'pt', 'hu'];
const ITALIAN = new Set(['allegati', 'critiche', 'risultati']);

test('every language names every folder, safe to type, and no Italian name outside Italian', () => {
  for (const lang of LANGS) {
    const names = lib.catalogFolders(lang, catalog);
    assert.deepEqual(Object.keys(names), [...lib.INTERNAL], lang);
    for (const [key, name] of Object.entries(names)) {
      assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, `${lang}.${key}: no spaces, no accents`);
      if (lang !== 'it') assert.ok(!ITALIAN.has(name), `${lang}.${key} is Italian: ${name}`);
    }
  }
  assert.equal(lib.catalogFolders('hu', catalog).allegati, 'mellekletek');
});

test('the language of the person picks the names, and jht.config.json can set its own', () => {
  const home = temporary(join(tmpdir(), 'jht-uf-home-'));
  writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale: 'de' }));
  assert.equal(lib.userFolders({ env: {}, home, catalog }).allegati, 'Anlagen');
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify({ folders: { allegati: 'Unterlagen', critiche: '../escape' } }));
  const own = lib.userFolders({ env: {}, home, catalog });
  assert.equal(own.allegati, 'Unterlagen');
  assert.equal(own.critiche, 'Bewertungen', 'an unsafe name is refused');
});

test('the name on the disk wins: an old «allegati» is named as it is until it is renamed', () => {
  const user = temporary(join(tmpdir(), 'jht-uf-user-'));
  const wanted = lib.catalogFolders('hu', catalog);
  mkdirSync(join(user, 'allegati'));
  assert.equal(lib.onDisk(wanted, user).allegati, 'allegati');
  mkdirSync(join(user, 'mellekletek'));
  assert.equal(lib.onDisk(wanted, user).allegati, 'mellekletek');
  assert.equal(lib.onDisk(wanted, user).critiche, 'ertekelesek', 'none there: the name it will have');
});

test('where.folders gives the path of the person system, and the resolved file is written for the host side', () => {
  const home = temporary(join(tmpdir(), 'jht-uf-home2-'));
  const user = temporary(join(tmpdir(), 'jht-uf-user2-'));
  writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale: 'es' }));
  mkdirSync(join(user, 'adjuntos'));
  const win = lib.whereFolders('windows', { env: {}, home, userDir: user, catalog });
  assert.equal(win.allegati.name, 'adjuntos');
  assert.equal(win.allegati.path, '%USERPROFILE%\\Documents\\Job Hunter Team\\adjuntos');
  assert.equal(win.allegati.open, 'mkdir -Force "$env:USERPROFILE\\Documents\\Job Hunter Team\\adjuntos" | Out-Null; explorer "$env:USERPROFILE\\Documents\\Job Hunter Team\\adjuntos"');
  assert.equal(lib.whereFolders('linux', { hostType: 'vps', env: {}, home, userDir: user, catalog }).allegati.open, null, 'a server has no window');
  assert.match(lib.whereFolders('macos', { env: {}, home, userDir: user, catalog }).allegati.open, /^mkdir -p ".*adjuntos" && open ".*adjuntos"$/);
  assert.equal(lib.whereFolders('macos', { env: {}, home, userDir: user, catalog }).allegati.path, '~/Documents/Job Hunter Team/adjuntos');
  const path = lib.writeUserFolders({ env: {}, home, catalog });
  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(written.language, 'es');
  assert.equal(written.folders.allegati, 'adjuntos');
});

test('inside the container the name the wrapper mounted wins, and a rewrite of the file keeps it', () => {
  const home = temporary(join(tmpdir(), 'jht-uf-home3-'));
  const user = temporary(join(tmpdir(), 'jht-uf-user3-'));
  writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale: 'hu' }));
  mkdirSync(join(user, 'allegati'));                                // inside the container the internal name is what is there
  writeFileSync(join(home, 'user-folders.json'), JSON.stringify({ mounted: { allegati: 'mellekletek', cv: '../x' } }));
  const seen = lib.whereFolders('macos', { env: {}, home, userDir: user, catalog });
  assert.equal(seen.allegati.name, 'mellekletek');
  assert.equal(seen.cv.name, 'cv', 'an unsafe mounted name is ignored');
  lib.writeUserFolders({ env: {}, home, catalog });
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'user-folders.json'), 'utf8')).mounted, { allegati: 'mellekletek', cv: '../x' });
});

test('setup saves the names for each chosen language without changing other catalog entries', async () => {
  const { assembleAndSaveConfig } = await import('../wizard/setup-steps.js');
  const home = process.env.JHT_HOME;
  for (const lang of LANGS) {
    rmSync(join(home, 'jht.config.json'), { force: true });
    writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale: lang }));
    const saved = await assembleAndSaveConfig({}, { providerChoice: 'openai', authMethod: 'subscription',
      model: 'test-model', baseProviders: {}, harness: 'pi' });
    assert.deepEqual(saved.folders, catalog.folders[lang], lang);
    assert.deepEqual(JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8')).folders, catalog.folders[lang]);
    assert.deepEqual(JSON.parse(readFileSync(join(home, 'user-folders.json'), 'utf8')).folders, catalog.folders[lang]);
  }
  assert.ok(catalog.roles && catalog.languages && catalog._doc);
});

test('unsafe or colliding names never become commands or folder mappings', () => {
  const home = temporary(join(tmpdir(), 'jht-uf-unsafe-'));
  for (const bad of ['../escape', 'CON', 'aux.txt', 'folder.', 'folder\n', 'cv', 'CV', 'reviews']) {
    writeFileSync(join(home, 'jht.config.json'), JSON.stringify({ folders: { allegati: bad } }));
    assert.equal(lib.userFolders({ env: {}, home, catalog, language: 'en' }).allegati, 'attachments', bad);
    if (!['cv', 'CV', 'reviews'].includes(bad)) assert.equal(lib.openCommand(bad, 'macos'), null);
  }
});
