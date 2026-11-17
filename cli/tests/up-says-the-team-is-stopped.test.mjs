// `jht up` starts the container, not the team: when the person stopped the team (.team-halted.flag) it says so and names the way back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { teamStoppedByPerson } from '../src/lib/team-halt-note.js';
import { openSetup, setupOpenPath } from '../src/lib/setup-open.js';
import en from '../src/lib/texts/en.js';
import it from '../src/lib/texts/it.js';

const home = () => mkdtempSync(join(tmpdir(), 'jht-up-'));

test('no flag: nothing to say', () => {
  assert.equal(teamStoppedByPerson(home()), false);
});

test('the flag of a stop by the person (jht team stop --all, Stop in the app) is told', () => {
  const h = home();
  writeFileSync(join(h, '.team-halted.flag'), 'user-stop\n');
  assert.equal(teamStoppedByPerson(h), true);
  writeFileSync(join(h, '.team-halted.flag'), '');
  assert.equal(teamStoppedByPerson(h), true, 'an empty flag is still a stop');
});

test('the wait of a first installation for its setup is not «you stopped it»', () => {
  const h = home();
  writeFileSync(join(h, '.team-halted.flag'), 'initial-setup\n');
  assert.equal(teamStoppedByPerson(h), false);
});

test('the words name the command that starts the team again, in English and in Italian', () => {
  for (const words of [en, it]) assert.match(words['container.team_stopped'], /jht team start/);
});

test('a link put in the place of the setup flag is not written through', () => {
  const h = home();
  const target = join(h, 'elsewhere');
  writeFileSync(target, 'keep\n');
  symlinkSync(target, setupOpenPath(h));
  assert.equal(openSetup(h), true);
  assert.equal(readFileSync(target, 'utf8'), 'keep\n');
  assert.equal(existsSync(setupOpenPath(h)), true);
});
