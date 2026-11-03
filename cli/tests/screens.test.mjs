import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATEST_CONFIG_VERSION } from '../src/commands/migrate.js';
import { visibleLength } from '../src/lib/ui.js';

// The main screens, run as a person (or a script) would: on a pipe, with a home of their own. The same text must
// come out without a control byte, fit 60 columns, say the next step when something is missing, and the doctor
// must leave a code that a script can read.
const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

function sandbox({ config = false, sessions = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-screens-'));
  const home = join(root, '.jht');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  const tool = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  tool('tmux', `case "$*" in *list-sessions*) printf '${sessions}' ;; *) echo 'tmux 3.5' ;; esac`);
  tool('git', 'echo "git version 2.0"');
  tool('npm', 'echo 10.0.0');
  if (config) {
    writeFileSync(join(home, 'jht.config.json'), JSON.stringify({ version: LATEST_CONFIG_VERSION, active_provider: 'openai', providers: { openai: { auth_method: 'subscription', model: 'gpt' } } }));
  }
  return { root, home, bin };
}

function jht(args, box, env = {}) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    env: { PATH: `${box.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: box.root, JHT_HOME: box.home, LANG: 'en_US.UTF-8', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', ...env },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  });
  return { out: `${result.stdout}${result.stderr}`, status: result.status };
}

test('status, agents, doctor and team status carry no control byte on a pipe, and fit 60 columns', () => {
  const box = sandbox();
  for (const args of [['status'], ['agents'], ['doctor'], ['doctor', '--all'], ['team', 'status'], ['team', 'list'], ['providers']]) {
    const { out } = jht(args, box, { COLUMNS: '60' });
    assert.doesNotMatch(out, /\u001b\[/, args.join(' '));
    for (const line of out.split('\n')) assert.ok(visibleLength(line) <= 60, `${args.join(' ')}: ${line}`);
  }
});

test('an empty state says what to do next', () => {
  const box = sandbox();
  assert.match(jht(['status'], box).out, /→ Set it up with: jht setup/);
  assert.match(jht(['agents'], box).out, /→ Start the team with: jht team start/);
  assert.match(jht(['team', 'status'], box).out, /→ Start the team with: jht team start/);
});

test('the doctor starts with the count, lists only what needs attention, and exits 1 when there is a problem', () => {
  const box = sandbox();
  const { out, status } = jht(['doctor'], box);
  assert.equal(status, 1);
  assert.match(out, /^\s*Check · \d+ ok · \d+ warning(s)? · 1 problem/m);
  assert.match(out, /✗ No configuration yet\n\s+→ jht setup/);
  assert.doesNotMatch(out, /✓ npm/);
  assert.match(out, /→ Every check: jht doctor --all/);
  assert.match(jht(['doctor', '--all'], box).out, /✓ npm: /);
  assert.ok(out.split('\n').length < 20, 'short');
});

test('the doctor exits 0 for a system that works, with or without warnings', () => {
  const box = sandbox({ config: true });
  const { out, status } = jht(['doctor'], box);
  assert.equal(status, 0, out);
  assert.doesNotMatch(out, /problem/);
});

test('--json gives a script the same facts: doctor, status, agents', () => {
  const box = sandbox({ config: true, sessions: 'CAPITANO\\nSCOUT-1\\n' });
  const doctor = JSON.parse(jht(['doctor', '--json'], box).out);
  assert.equal(doctor.ok, true);
  assert.ok(doctor.checks.every((c) => ['ok', 'warn', 'fail', 'info'].includes(c.status)));
  const status = JSON.parse(jht(['status', '--json'], box).out);
  assert.equal(status.configured, true);
  assert.deepEqual(status.sessions, ['CAPITANO', 'SCOUT-1']);
  const agents = JSON.parse(jht(['agents', '--json'], box).out);
  assert.equal(agents.running, 2);
  assert.equal(agents.agents.find((a) => a.id === 'capitano').running, true);
});
