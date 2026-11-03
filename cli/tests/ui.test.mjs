import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { errorBlock, hint, marks, statusLine, stripAnsi, table, terminalWidth, title, truncate, visibleLength } from '../src/lib/ui.js';

const ui = fileURLToPath(new URL('../src/lib/ui.js', import.meta.url));

test('the width counts what is seen: marks and colour included', () => {
  assert.equal(visibleLength('\u001b[32m✓\u001b[39m ok'), 4);
  assert.equal(stripAnsi('\u001b[1mx\u001b[22m'), 'x');
});

test('a long text is cut with an ellipsis to the width asked, and a short one is left alone', () => {
  assert.equal(truncate('abcdefghij', 6), 'abcde…');
  assert.equal([...truncate('abcdefghij', 6)].length, 6);
  assert.equal(truncate('abc', 6), 'abc');
});

test('a table never goes over the width, at 60, 80 and 100 columns, and its columns line up', () => {
  const columns = [{ label: 'Agent' }, { label: 'Session' }, { label: 'State' }, { label: 'Description', shrink: true }];
  const rows = [
    ['✓ Capitano', 'CAPITANO', 'running', 'Coordinates the whole pipeline and reports to the person every day'],
    ['· Scout', 'SCOUT-1', 'stopped', 'Finds job opportunities on the portals of the countries in the profile'],
  ];
  for (const width of [60, 80, 100]) {
    const lines = table(columns, rows, { width }).split('\n');
    for (const line of lines) assert.ok(visibleLength(line) <= width, `${width}: ${line}`);
    // the second column starts at the same place on every line
    const starts = lines.filter((l) => !/^\s*─/.test(l)).map((l) => l.indexOf('SESSION') >= 0 ? 0 : l.search(/CAPITANO|SCOUT-1|Session/));
    assert.equal(new Set(starts).size, 1, `${width}: ${starts}`);
  }
});

test('a mark in the first column does not push the next one: the header lines up with the rows', () => {
  const lines = table([{ label: 'Agent' }, { label: 'State' }], [['✓ Capitano', 'running'], ['· Scout', 'stopped']], { width: 80 }).split('\n');
  const col = (l, word) => l.indexOf(word);
  assert.equal(col(lines[0], 'State'), col(lines[2], 'running'));
  assert.equal(col(lines[0], 'State'), col(lines[3], 'stopped'));
});

test('four marks only, and JHT_ASCII turns them into plain characters', () => {
  assert.deepEqual(['ok', 'warn', 'fail', 'info'].map((k) => marks()[k]), ['✓', '!', '✗', '·']);
  const run = spawnSync(process.execPath, ['-e', `import('${ui}').then((m) => console.log(m.marks().ok, m.marks().fail))`], {
    env: { PATH: process.env.PATH, JHT_ASCII: '1' }, encoding: 'utf8',
  });
  assert.equal(run.stdout.trim(), '+ x');
});

test('on a pipe nothing here writes a control byte, and a hint says the next step', () => {
  const text = [title('Agents', '0 of 7 active'), statusLine('fail', 'No configuration', { hint: 'jht setup' }), hint('jht up'), errorBlock({ what: 'x', why: 'y', fix: 'z' })].join('\n');
  assert.doesNotMatch(text, /\u001b\[/);
  assert.match(text, /Agents · 0 of 7 active/);
  assert.match(text, /✗ No configuration\n\s+→ jht setup/);
  assert.match(text, /^Error: x\n  y\n  → z/m);
});

test('the terminal width is bounded, and falls back to COLUMNS and then to 80', () => {
  assert.equal(terminalWidth({ columns: 20 }), 40);
  assert.equal(terminalWidth({ columns: 300 }), 120);
  assert.equal(terminalWidth({ columns: 72 }), 72);
  assert.equal(terminalWidth({}), Number(process.env.COLUMNS) ? Math.max(40, Math.min(Number(process.env.COLUMNS), 120)) : 80);
});

test('columns marked drop leave, from the right, when the table is still too wide', () => {
  const columns = [{ label: 'Role' }, { label: 'Session' }, { label: 'Kind', drop: true }, { label: 'Effort', drop: true }, { label: 'What it does', shrink: true, min: 24 }];
  const rows = [['capitano', 'JHT-CAPITANO', 'one', 'high', 'Coordinates the Job Hunter pipeline for the person every day']];
  const narrow = table(columns, rows, { width: 60 }).split('\n');
  for (const line of narrow) assert.ok(visibleLength(line) <= 60, line);
  assert.doesNotMatch(narrow[0], /Effort/);
  assert.match(narrow[0], /What it does/);
  const tiny = table(columns, rows, { width: 50 }).split('\n');
  for (const line of tiny) assert.ok(visibleLength(line) <= 50, line);
  assert.doesNotMatch(tiny[0], /Kind|Effort/);
  const wide = table(columns, rows, { width: 100 }).split('\n');
  assert.match(wide[0], /Kind\s+Effort\s+What it does/);
});
