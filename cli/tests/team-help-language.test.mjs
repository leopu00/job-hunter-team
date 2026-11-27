// `jht team --help` in the language of the person, like the screens of the team (giro Mac build11, Portuguese: the help was
// all English). The titles commander writes by itself are said too, and no English «(default: …)» is added to an option.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CATALOGS } from '../src/lib/texts.js';

const JHT = fileURLToPath(new URL('../bin/jht.js', import.meta.url));
const ENGLISH = ['Usage:', 'Options:', 'Commands:', 'display help for command', 'Manage the Job Hunter Team agents', '(default:'];

function help(args, lang) {
  const home = mkdtempSync(join(tmpdir(), 'jht-team-help-'));
  const result = spawnSync(process.execPath, [JHT, ...args], { encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: home, JHT_HOME: join(home, '.jht'), JHT_LANG: lang, NO_COLOR: '1' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

for (const lang of ['pt', 'it', 'de', 'fr', 'es', 'hu']) {
  test(`jht team --help in ${lang}`, () => {
    const say = (key) => CATALOGS[lang][key];
    const out = help(['team', '--help'], lang);
    for (const key of ['team.help.title_usage', 'team.help.title_options', 'team.help.title_commands', 'team.help.description',
      'team.help.status', 'team.help.chat', 'team.help.help']) {
      assert.ok(out.includes(say(key)), `${key}: ${out}`);
    }
    for (const word of ENGLISH) assert.ok(!out.includes(word), `${word} in: ${out}`);
    const start = help(['team', 'start', '--help'], lang);
    // commander lists the arguments only when they have a description: no «Arguments:» title here
    assert.ok(start.includes(say('team.help.start_mode')) && start.includes(say('team.help.title_options')), start);
    for (const word of ENGLISH) assert.ok(!start.includes(word), `${word} in: ${start}`);
  });
}

test('in English the help is the one of before, without the default commander added to --mode', () => {
  const out = help(['team', '--help'], 'en');
  assert.match(out, /^Usage: jht team \[options\] \[command\]/);
  assert.match(out, /Manage the Job Hunter Team agents/);
  // `status [options]`: --json is what the Assistente reads for the state of the team (JHT-T354)
  assert.match(out, /Commands:[\s\S]*status \[options\]\s+Show currently active agents/);
  assert.match(help(['team', 'start', '--help'], 'en'), /-m, --mode <mode>\s+mode: default \(when not given\) or fast\n/);
});
