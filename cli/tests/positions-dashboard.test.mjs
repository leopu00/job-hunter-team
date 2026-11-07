import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderPositionsDashboard, validDashboard } from '../src/lib/positions-dashboard.js';
import { renderPositionCard } from '../src/lib/position-card.js';

const home = mkdtempSync(join(tmpdir(), 'jht-dashboard-'));
process.env.JHT_HOME = home;
process.env.JHT_LANG = 'en';
after(() => rmSync(home, { recursive: true }));
const choose = (locale) => writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale }));
const sample = Object.freeze({
  total: 15, by_status: { new: 12, checked: 1, scored: 2 }, positions_with_company_id: 2,
  top_scores: [
    { id: 8, title: '⟦EXT·12345678⟧DevOps Engineer Associate Middleware Platform⟦/EXT·12345678⟧',
      company: 'Example Systems', total_score: 82, status: 'scored' },
    { id: 9, title: 'Frontend Developer', company: 'Example Labs', total_score: 0, status: 'excluded' },
  ],
  companies_by_verdict: { GO: 2 },
  applications: [{ position_id: 9, title: 'Frontend Developer', company: 'Example Labs',
    status: 'review', critic_verdict: 'NEEDS_WORK' }],
});

test('dashboard explains counts, keeps full titles and IDs and ranks by the existing score order', () => {
  choose('it');
  const original = JSON.stringify(sample);
  const shown = renderPositionsDashboard(sample);
  assert.match(shown, /^La tua ricerca di lavoro\nOfferte trovate: 15\nDa valutare: 13\nValutate: 2/);
  assert.match(shown, /1\. #8 · DevOps Engineer Associate Middleware Platform/);
  assert.match(shown, /jht positions show 8/);
  assert.match(shown, /jht positions show 9/);
  assert.match(shown, /0\/100 · Esclusa · Esito della revisione: Da rivedere/);
  assert.match(shown, /2 su 15: offerte con un riferimento alla scheda dell’azienda/);
  assert.doesNotMatch(shown, /CompanyID|Schema V2|GO2|EXT·|companies_by_verdict|Valutazioni delle aziende/);
  assert.equal(JSON.stringify(sample), original);
});

test('full adds translated phases, company verdicts, applications and technical coverage', () => {
  choose('it');
  const shown = renderPositionsDashboard(sample, { full: true });
  assert.match(shown, /Tutte le fasi\nNuova: 12\nAnalizzata: 1\nValutata: 2/);
  assert.match(shown, /Valutazioni delle aziende\nPositiva: 2/);
  assert.match(shown, /Dettagli delle candidature/);
  assert.match(shown, /2\/15 \(13%\)/);
  assert.doesNotMatch(shown, /\bGO\b|\bNO_GO\b|Schema|position_card\./);
});

test('the ten-row machine limit is disclosed rather than presented as the total', () => {
  choose('it');
  const top_scores = Array.from({ length: 10 }, (_, id) => ({ id, title: `Offer ${id}`,
    company: 'Example', total_score: 90 - id, status: 'scored' }));
  const shown = renderPositionsDashboard({ ...sample, total: 100, top_scores });
  assert.match(shown, /Valutate: almeno 10/);
  assert.match(shown, /fino a 10/);
  assert.doesNotMatch(shown, /Valutate: 10\n/);
});

test('empty and unscored searches have an explicit state without dividing by zero', () => {
  choose('it');
  const empty = { total: 0, by_status: {}, top_scores: [], applications: [],
    companies_by_verdict: {}, positions_with_company_id: 0 };
  assert.equal(validDashboard(empty), true);
  const shown = renderPositionsDashboard(empty, { full: true });
  assert.match(shown, /Valutate: 0/);
  assert.match(shown, /Nessuna offerta ha ancora un punteggio/);
  assert.match(shown, /0\/0 \(0%\)/);
  assert.doesNotMatch(shown, /NaN|Infinity/);
  for (const value of [null, [], {}, { ...empty, total: -1 }, { ...empty, top_scores: [null] }]) {
    assert.equal(Boolean(validDashboard(value)), false);
  }
});

test('dashboard follows the same seven canonical language preferences as show', () => {
  for (const [locale, title] of Object.entries({ en: 'Your job search', it: 'La tua ricerca di lavoro',
    hu: 'Az álláskeresésed', es: 'Tu búsqueda de empleo', de: 'Deine Jobsuche',
    fr: 'Ta recherche d’emploi', pt: 'A tua procura de emprego' })) {
    choose(locale);
    const shown = renderPositionsDashboard(sample, { full: true });
    assert.ok(shown.startsWith(`${title}\n`), locale);
    assert.doesNotMatch(shown, /position_card\.|CompanyID|Schema|EXT·|\bNO_GO\b/, locale);
    assert.doesNotMatch(shown, /%[sd]/, locale);
  }
});

test('both views translate canonical review verdicts and application stages in all languages', () => {
  for (const locale of ['en', 'it', 'hu', 'es', 'de', 'fr', 'pt']) {
    choose(locale);
    for (const critic_verdict of ['PASS', 'NEEDS_WORK', 'REJECT']) {
      for (const status of ['draft', 'approved']) {
        const application = { ...sample.applications[0], critic_verdict, status };
        const dashboard = renderPositionsDashboard({ ...sample, applications: [application] }, { full: true });
        const card = renderPositionCard({ ...sample.top_scores[1], critic_verdict, app_status: status }, { full: true });
        assert.doesNotMatch(dashboard + card, /\bPASS\b|NEEDS_WORK|\bREJECT\b|\bdraft\b|\bapproved\b|position_card\./, locale);
      }
    }
  }
});
