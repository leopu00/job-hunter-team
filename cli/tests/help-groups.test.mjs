import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProgram } from '../src/program.js';
import { HIDDEN_COMMANDS, OTHER_GROUP, groupCommands, renderFullHelp } from '../src/lib/help-groups.js';

const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

function jht(args, { cols } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jht-help-'));
  const result = spawnSync(process.execPath, [entry, ...args], {
    env: { PATH: process.env.PATH, HOME: home, JHT_HOME: join(home, '.jht'), LANG: 'en_US.UTF-8', ...(cols ? { COLUMNS: String(cols) } : {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  return { out: result.stdout, err: result.stderr, status: result.status };
}

test('every command is hidden on purpose or in a group: none falls in "Other"', () => {
  const groups = groupCommands(buildProgram());
  const other = groups.find((g) => g.title === OTHER_GROUP);
  assert.deepEqual(other?.commands.map((c) => c.name()) ?? [], [], 'place the new command in HELP_GROUPS (or HIDDEN_COMMANDS)');
});

test('the long help is in groups, lists no dead or machine-only command, and still lets them run', () => {
  const program = buildProgram();
  const text = renderFullHelp(program, 80);
  for (const title of ['Every day:', 'Your team:', 'Your data:', 'Maintenance:']) assert.match(text, new RegExp(`^${title}$`, 'm'));
  for (const name of HIDDEN_COMMANDS) assert.doesNotMatch(text, new RegExp(`^  ${name}[ |]`, 'm'), name);
  assert.doesNotMatch(text, /not implemented|deprecated|not for typing|proxy/);
  // hidden, but registered: a script that calls them still finds them, and their own help answers
  for (const name of ['plugins', 'stats', 'agent-control']) {
    assert.ok(program.commands.some((c) => c.name() === name), name);
  }
  assert.equal(jht(['plugins', '--help']).status, 0);
});

test('every line of the long help fits the width of the terminal, at 60, 80 and 100 columns', () => {
  const program = buildProgram();
  for (const width of [60, 80, 100]) {
    for (const line of renderFullHelp(program, width).split('\n')) {
      assert.ok([...line].length <= width, `${width}: "${line}"`);
    }
  }
});

test('`jht help` on a pipe is the same grouped text as on a terminal', () => {
  const { out, status } = jht(['help']);
  assert.equal(status, 0);
  assert.match(out, /^Every day:$/m);
  assert.doesNotMatch(out, /\u001b\[/);
});

test('a group of commands asked with nothing after it shows its help on stdout and exits 0', () => {
  for (const group of ['cron', 'working-hours', 'apply']) {
    const { out, status } = jht([group]);
    assert.equal(status, 0, group);
    assert.match(out, /^Usage: jht /, group);
  }
});

test('the example of a cron schedule has the five fields of a cron expression', () => {
  const { out } = jht(['cron', '--help']);
  const example = out.match(/--schedule "([^"]+)"/)?.[1];
  assert.equal(example?.split(/\s+/).length, 5, example);
});
