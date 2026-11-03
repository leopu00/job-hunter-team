import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATEST_CONFIG_VERSION } from '../src/commands/migrate.js';
import { visibleLength } from '../src/lib/ui.js';

// A bare `jht`: a welcome with the state of today and one next step, exit 0, no control byte on a pipe, 60 columns.
const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

function box({ config = false, sessions = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-welcome-'));
  const home = join(root, '.jht');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh\ncase "$*" in *list-sessions*) printf '${sessions}' ;; *) echo 'tmux 3.5' ;; esac\n`);
  chmodSync(join(bin, 'tmux'), 0o755);
  if (config) {
    writeFileSync(join(home, 'jht.config.json'), typeof config === 'string' ? config : JSON.stringify({ version: LATEST_CONFIG_VERSION, active_provider: 'openai', providers: { openai: { model: 'gpt' } } }));
  }
  return { root, home, bin };
}

function bare(b, env = {}, args = []) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    env: { PATH: `${b.bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: b.root, JHT_HOME: b.home, JHT_LANG: 'en', COLUMNS: '60', ...env },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  });
  return { out: `${result.stdout}${result.stderr}`, status: result.status };
}

test('before the first setup the welcome says one thing: jht setup', () => {
  const { out, status } = bare(box());
  assert.equal(status, 0);
  assert.match(out, /Job Hunter Team/);
  assert.match(out, /Start here: jht setup/);
  assert.equal(/jht team start|jht agents/.test(out), false, 'one thing only');
});

test('with a setup and the team off it says where things stand and how to turn the team on', () => {
  const { out, status } = bare(box({ config: true }));
  assert.equal(status, 0);
  assert.match(out, /Provider\s+openai/);
  assert.match(out, /Team\s+not running/);
  assert.match(out, /Turn the team on with: jht team start/);
  assert.match(out, /Everything else: jht help/);
});

test('with the team running it points to the agents', () => {
  const { out } = bare(box({ config: true, sessions: 'CAPITANO\\nSCOUT-1\\n' }));
  assert.match(out, /Team\s+2 running/);
  assert.match(out, /See how it is going with: jht agents/);
});

test('an unreadable configuration is said, with the way out', () => {
  const { out, status } = bare(box({ config: '{not json' }));
  assert.equal(status, 0);
  assert.match(out, /cannot be read/);
  assert.match(out.replace(/\s+/g, ' ').replace('→ ', ''), /jht setup --reset/);
});

test('it carries no control byte on a pipe, fits 60 columns, and speaks the language of the person', () => {
  for (const b of [box(), box({ config: true })]) {
    const { out } = bare(b);
    assert.equal(/\u001b/.test(out), false);
    for (const line of out.split('\n')) assert.ok(visibleLength(line) <= 60, `too wide: ${line}`);
  }
  assert.match(bare(box(), { JHT_LANG: 'it' }).out, /Comincia da qui: jht setup/);
});

test('--help is still the short list, and an unknown command is still an error', () => {
  const b = box();
  assert.match(bare(b, {}, ['--help']).out, /Essential commands/);
  assert.notEqual(bare(b, {}, ['nope']).status, 0);
});
