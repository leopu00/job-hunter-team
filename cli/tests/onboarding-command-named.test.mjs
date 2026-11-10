// After the first setup the person has to know HOW to answer the Assistente (D11 of the 10/11 test): the command is
// named in the end of the setup, in every language, and in the line of `team start` that says the rest of the team waits.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CATALOGS } from '../src/lib/texts.js';

const COMMAND = 'jht team chat assistente';
const locales = fileURLToPath(new URL('../../shared/locales/', import.meta.url));

test('the end of the setup names the command to answer the Assistente, in every language, with the other three commands kept', () => {
  const files = readdirSync(locales).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 7, files.join(','));
  for (const file of files) {
    const text = JSON.parse(readFileSync(new URL(file, `file://${locales}`), 'utf8'))['wizard.outro_done'];
    assert.ok(text.includes(COMMAND), `${file}: ${text}`);
    for (const kept of ['jht team status', 'jht logs --tail 30', 'jht team stop --all']) assert.ok(text.includes(kept), `${file} keeps ${kept}`);
  }
});

test('the line «the rest of the team starts by itself when the onboarding is done» says how to answer', () => {
  for (const lang of ['en', 'it']) assert.ok(CATALOGS[lang]['team.captain_waits'].includes(COMMAND), lang);
});
