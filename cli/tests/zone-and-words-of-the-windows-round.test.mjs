// Giro Windows 16/11 (build5): the installer starts the team before it writes host.env, so the container was made with
// JHT_USER_TZ=UTC while host.env said Europe/Berlin; the setup wrote the budget and the hours in UTC, and the chat said
// its times in UTC. And in an Italian setup the «Yes / No» of a question, the way to answer a card and what an answer
// did were English.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { localTimeZone } from '../src/lib/local-tz.js';
import { chatClock, formatCard, formatChatMessage } from '../src/commands/team/chat.js';
import { describeAnswer } from '../src/lib/terminal-answer.js';

// eslint-disable-next-line no-control-regex
const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

function homeWith(hostEnv) {
  const home = mkdtempSync(join(tmpdir(), 'jht-zone-'));
  if (hostEnv !== null) writeFileSync(join(home, 'host.env'), hostEnv);
  return home;
}

test('a UTC in the environment does not hold against the zone host.env says', () => {
  const home = homeWith('JHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Berlin\n');
  assert.equal(localTimeZone({ JHT_USER_TZ: 'UTC' }, home), 'Europe/Berlin');
  assert.equal(localTimeZone({ JHT_USER_TZ: 'Etc/UTC' }, home), 'Europe/Berlin');
});

test('a real zone in the environment still wins, and UTC chosen in host.env stays UTC', () => {
  assert.equal(localTimeZone({ JHT_USER_TZ: 'America/Sao_Paulo' }, homeWith('JHT_USER_TZ=Europe/Berlin\n')), 'America/Sao_Paulo');
  assert.equal(localTimeZone({ JHT_USER_TZ: 'UTC' }, homeWith('JHT_USER_TZ=UTC\n')), 'UTC');
  assert.equal(localTimeZone({ JHT_USER_TZ: 'UTC' }, homeWith(null)), 'UTC');
  assert.equal(localTimeZone({ JHT_USER_TZ: 'UTC' }, homeWith('JHT_LANG=it\n')), 'UTC');
});

test('the time of a chat message is said in the person zone, not in the container one', () => {
  const at = Date.UTC(2026, 10, 16, 14, 7, 5) / 1000; // 14:07:05 UTC = 15:07:05 in Berlin (CET)
  assert.equal(chatClock(at, 'Europe/Berlin'), '15:07:05');
  assert.equal(chatClock(at, 'UTC'), '14:07:05');
  assert.match(plain(formatChatMessage({ id: 'm', role: 'agent', text: 'Ciao', at }, 'assistente', 'Europe/Berlin')), /^Assistant 15:07:05\n/);
  assert.match(chatClock(at, 'Not/AZone'), /^\d\d:\d\d:\d\d$/, 'a zone that is not one still gives a time');
});

test('how to answer a card, and what the answer did, are said in Italian', () => {
  const card = { id: 'Q', code: 'Q1A2B', subject: 'Piano', text: 'Quale piano hai?', options: ['Plus', 'Pro'], multiple: false };
  const text = plain(formatCard(card, 'it'));
  assert.match(text, /Rispondi con il numero .*«Q1A2B 1»/);
  assert.doesNotMatch(text, /Answer with/);
  assert.match(plain(formatCard({ ...card, multiple: true }, 'it')), /rispondi dall'app/);
  assert.equal(describeAnswer({ result: 'answered', label: 'Conferma e salva' }, 'it').text, 'Risposta registrata: Conferma e salva');
  assert.equal(describeAnswer({ result: 'answered', label: '' }, 'it').text, 'Risposta registrata');
  assert.match(describeAnswer({ result: 'closed' }, 'it').text, /già chiusa/);
  const invalid = describeAnswer({ result: 'invalid', reason: 'that number is not one of the options', reasonKey: 'number_out_of_range' }, 'it');
  assert.equal(invalid.failed, true);
  assert.match(invalid.text, /^Non inviato: quel numero non è fra le opzioni\./);
});

test('the Yes / No of a setup question are in the language of the person', () => {
  const home = mkdtempSync(join(tmpdir(), 'jht-yesno-'));
  const read = (locale) => {
    writeFileSync(join(home, 'i18n-prefs.json'), JSON.stringify({ locale }));
    const run = spawnSync(process.execPath, ['--input-type=module', '-e',
      "const m = await import(process.argv[1]); console.log(m.answerWord('common.yes') + '|' + m.answerWord('common.no'));",
      new URL('../wizard/clack-prompter.js', import.meta.url).href], { encoding: 'utf8', env: { ...process.env, JHT_HOME: home } });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  };
  assert.equal(read('it'), 'Sì|No');
  assert.equal(read('en'), 'Yes|No');
  assert.equal(read('de'), 'Ja|Nein');
});
