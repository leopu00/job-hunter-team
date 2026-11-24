// P3-1 (collaudo Linux 23/11): in the setup the boxes «Account web» and «Chiave API» broke, their long lines going to the next row
// inside the frame. The notes of the wizard are wrapped to the terminal: at 80 columns every row of the box fits.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { note } from '@clack/prompts';
import { visibleLength, wrapNote } from '../wizard/note-width.js';

const LOCALES = resolve(import.meta.dirname, '../../shared/locales');
const LANGS = ['en', 'it', 'de', 'es', 'fr', 'hu', 'pt'];

function drawn(message, title, columns) {
  const out = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  try { note(wrapNote(message, columns), title); } finally { process.stdout.write = write; }
  return out.join('').split('\n').filter(Boolean);
}

test('a long line is wrapped at the spaces, its indentation kept, a link left whole', () => {
  const link = 'https://example.invalid/a/very/long/path/that/cannot/be/cut/without/breaking/the/copy/of/it';
  const text = `${'parola '.repeat(30).trim()}\n    ${'rientro '.repeat(20).trim()}\nbreve\n${link}`;
  const wrapped = wrapNote(text, 80).split('\n');
  assert.ok(wrapped.every((row) => row === link || visibleLength(row) <= 74), wrapped.join('\n'));
  assert.ok(wrapped.filter((row) => row.includes('rientro')).every((row) => row.startsWith('    rientro')));
  assert.ok(wrapped.includes('breve') && wrapped.includes(link));
  assert.equal(wrapped.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '), 'no word is lost or cut');
});

test('at 80 columns the boxes of the web account and of the API key fit, in every language', () => {
  for (const lang of LANGS) {
    const texts = JSON.parse(readFileSync(resolve(LOCALES, `${lang}.json`), 'utf8'));
    const title = { cloud: texts['wizard.cloud.login_title'], key: texts['wizard.key.title'] };
    for (const [key, value] of Object.entries(texts)) {
      const group = key.startsWith('wizard.cloud.') ? 'cloud' : key.startsWith('wizard.key.') ? 'key' : null;
      if (!group || typeof value !== 'string' || key.endsWith('_title') || key === 'wizard.key.title') continue;
      const body = value.replace(/%s/g, 'Example').replace(/\{\w+\}/g, 'Example');
      for (const row of drawn(body, title[group], 80)) {
        assert.ok(visibleLength(row) <= 80, `${lang} ${key}: ${visibleLength(row)} columns: ${row}`);
      }
    }
  }
});
