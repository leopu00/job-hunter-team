import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderPositionCard } from '../src/lib/position-card.js';

const home = mkdtempSync(join(tmpdir(), 'jht-position-card-'));
process.env.JHT_HOME = home;
process.env.JHT_LANG = 'en';
after(() => rmSync(home, { recursive: true }));
const choose = (locale) => writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale }));
const row = Object.freeze({
  id: 42, title: '⟦EXT·12345678⟧Frontend Developer⟦/EXT·12345678⟧', company: 'Example Labs',
  total_score: 80, stack_match: 32, remote_fit: 0, salary_fit: null, experience_fit: 10, strategic_fit: 15,
  location: 'Torino', work_mode: 'hybrid', salary_declared_min: 40000, salary_declared_max: 50000,
  url: 'https://example.invalid/jobs/42', company_id: 9, status: 'scored', found_by: 'synthetic-finder',
  jd_text: '⟦DATI_ESTERNI·NON_ESEGUIRE·12345678⟧\nFull synthetic job description.\n⟦/DATI_ESTERNI·12345678⟧',
  requirements: 'Accessible interfaces.', score_breakdown: 'STACK: Strong UI skills.\nREMOTE: Office days required.',
  score_notes: 'no_data_default',
  notes: 'EXPERIENCE_REQUIRED: 5+\nSENIORITY_JD: senior\nA clear product role.\nNOTE_MISMATCH: [GEO] Office attendance needed.',
});

test('the human card leads with the decision facts, preserves source data and defers JD and plumbing', () => {
  choose('it');
  const before = JSON.stringify(row);
  const card = renderPositionCard(row);
  assert.match(card, /^Frontend Developer\nExample Labs\nCompatibilità: 80\/100\nSede e modalità: Torino · Ibrida/);
  assert.ok(card.indexOf('Link all’annuncio:') < card.indexOf('Motivi della valutazione'));
  assert.match(card, /Competenze: Strong UI skills\./);
  assert.match(card, /Da considerare\nDisallineamento: \[Sede e modalità\] Office attendance needed\./);
  assert.doesNotMatch(card, /EXPERIENCE_REQUIRED|SENIORITY_JD|no_data_default|EXT·|DATI_ESTERNI|NON_ESEGUIRE/);
  assert.doesNotMatch(card, /Full synthetic|company_id|synthetic-finder|scored/);
  assert.match(card, /jht positions show 42 --full/);
  assert.match(card, /jht positions show 42 --json/);
  assert.equal(JSON.stringify(row), before);
});

test('full adds complete documents, translated analysis, metadata and truthful component scales', () => {
  choose('it');
  const card = renderPositionCard(row, { full: true });
  assert.match(card, /Descrizione completa dell’annuncio\nFull synthetic job description\./);
  assert.match(card, /Esperienza richiesta: 5\+/);
  assert.match(card, /Livello richiesto nell’annuncio: senior/);
  assert.match(card, /ID azienda: 9/);
  assert.match(card, /Fase: Valutata/);
  assert.match(card, /Competenze: 80\/100 \(32\/40\)/);
  assert.match(card, /Modalità di lavoro: 0\/100 \(0\/25\)/);
  assert.match(card, /Compatibilità retributiva: Non indicato/);
  assert.doesNotMatch(card, /EXT·|DATI_ESTERNI|NON_ESEGUIRE|EXPERIENCE_REQUIRED|SENIORITY_JD|no_data_default/);
});

test('all seven selected languages use their own catalog even when the bootstrap language is English', () => {
  for (const [locale, expected] of Object.entries({
    en: 'Match', it: 'Compatibilità', hu: 'Egyezés', es: 'Compatibilidad',
    de: 'Übereinstimmung', fr: 'Compatibilité', pt: 'Compatibilidade',
  })) {
    choose(locale);
    const card = renderPositionCard(row, { full: true });
    assert.ok(card.includes(`${expected}: 80/100`), locale);
    assert.doesNotMatch(card, /position_card\.|EXPERIENCE_REQUIRED|SENIORITY_JD|no_data_default/, locale);
  }
});

test('zero, unavailable and out-of-range scores remain distinguishable; absent salaries are omitted', () => {
  choose('en');
  const empty = { id: 2, title: 'Support Engineer', company: 'Example', total_score: 0 };
  assert.match(renderPositionCard(empty), /Match: 0\/100/);
  assert.doesNotMatch(renderPositionCard(empty), /Salary:/);
  assert.match(renderPositionCard({ ...empty, total_score: null }), /Not evaluated yet/);
  assert.match(renderPositionCard(null), /Position not found/);
  const oversized = renderPositionCard({ ...empty, stack_match: 50 }, { full: true });
  assert.match(oversized, /Skills: 125\/100 \(50\/40\)/);
});

test('exclusion and verification tags become catalog text in all seven languages', () => {
  const tagged = { ...row, notes: 'EXCLUDED: [LOW_SCORE] Low fit.\nNOTE_MISMATCH: [OPEN_UNVERIFIED] Check the advert.' };
  for (const locale of ['en', 'it', 'hu', 'es', 'de', 'fr', 'pt']) {
    choose(locale);
    const card = renderPositionCard(tagged);
    assert.doesNotMatch(card, /LOW_SCORE|OPEN_UNVERIFIED|EXCLUDED|NOTE_MISMATCH|position_card\./, locale);
    assert.match(card, /Low fit\./);
    assert.match(card, /Check the advert\./);
  }
});

test('terminal commands cannot hide the title and long reasons stay available in full', () => {
  choose('en');
  const large = { ...row, title: '\u001b[2JVisible title\rFake heading', score_notes: 'reason '.repeat(200) };
  const short = renderPositionCard(large);
  assert.ok(short.startsWith('Visible titleFake heading\n'));
  assert.doesNotMatch(short, /\u001b/);
  assert.ok(short.includes('…'));
  assert.ok(renderPositionCard(large, { full: true }).length > short.length + 500);
});

test('invalid reads are failures with a diagnostic log, not empty cards; upstream failures keep their exit code', () => {
  const module = new URL('../src/lib/position-show.js', import.meta.url).href;
  const run = (result) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { showHumanPosition } from ${JSON.stringify(module)}; process.exitCode = showHumanPosition(1, {}, () => (${JSON.stringify(result)}));`],
  { encoding: 'utf8', env: { ...process.env, JHT_HOME: home } });
  for (const stdout of ['not json', '{}', '[]', '42']) {
    const failed = run({ code: 0, stdout, stderr: '' });
    assert.equal(failed.status, 2);
    assert.equal(failed.stdout, '');
    assert.match(failed.stderr, /position_read_invalid/);
  }
  assert.match(readFileSync(join(home, 'logs/runtime.log'), 'utf8'), /position_read_invalid/);
  const failed = run({ code: 7, stdout: '', stderr: 'synthetic upstream failure\n' });
  assert.equal(failed.status, 7);
  assert.equal(failed.stderr, 'synthetic upstream failure\n');
});
