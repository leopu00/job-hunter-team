// `jht team start` takes the user's stop (.team-halted.flag) away only once it can really start: with no
// provider, or without tmux and the provider's CLI, the start refuses and the team stays stopped.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { startRefusal } from '../src/commands/team/start.js';

const JHT = resolve(import.meta.dirname, '../bin/jht.js');
const FLAG_TEXT = 'halted_by=team-state-reconciler\nat=2026-10-24T22:32:51.000Z\n';

// A computer with no container engine: `team start` takes the host path, on a JHT_HOME of its own.
function box({ config, tmux = false, cli = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jht-start-gate-'));
  const home = join(root, '.jht');
  const bin = join(root, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(home, '.team-halted.flag'), FLAG_TEXT);
  if (config !== undefined) writeFileSync(join(home, 'jht.config.json'), JSON.stringify(config));
  // a fake tmux that accepts everything, and a fake bash for the delayed «Enter» the start sends: nothing real
  // is launched, but a start that gets going reaches the end
  if (tmux) writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'bash'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  if (cli) writeFileSync(join(bin, cli), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const name of ['bash', 'tmux', cli].filter(Boolean)) if (existsSync(join(bin, name))) chmodSync(join(bin, name), 0o755);
  return { root, home, bin, flag: join(home, '.team-halted.flag') };
}

function start(b, ...args) {
  const r = spawnSync(process.execPath, [JHT, 'team', 'start', ...args], {
    encoding: 'utf8', timeout: 60000,
    // only the fake tools are on PATH: no docker, so the container is not running; `command -v` is a shell builtin
    env: { PATH: b.bin, HOME: b.root, JHT_HOME: b.home, JHT_USER_DIR: join(b.root, 'docs'), NO_COLOR: '1', JHT_LANG: 'en' },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test('without an active provider the start refuses and the stop stays', () => {
  for (const config of [undefined, {}, { active_provider: '' }, { active_provider: '  ' }, { active_provider: 'nobody' }]) {
    const b = box({ config, tmux: true, cli: 'codex' });
    const r = start(b);
    assert.notEqual(r.status, 0, JSON.stringify(config));
    assert.match(r.out, /no active provider/, JSON.stringify(config));
    assert.equal(readFileSync(b.flag, 'utf8'), FLAG_TEXT, JSON.stringify(config));
  }
});

test('with a provider but no tmux, or no CLI for it, the start refuses and the stop stays', () => {
  const noTmux = box({ config: { active_provider: 'openai' }, cli: 'codex' });
  let r = start(noTmux);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /tmux not found/);
  assert.equal(readFileSync(noTmux.flag, 'utf8'), FLAG_TEXT);

  const noCli = box({ config: { active_provider: 'openai' }, tmux: true });
  r = start(noCli);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /codex CLI of the active provider was not found/);
  assert.equal(readFileSync(noCli.flag, 'utf8'), FLAG_TEXT);
});

test('a start that can go ahead takes the stop away', () => {
  const b = box({ config: { active_provider: 'openai' }, tmux: true, cli: 'codex' });
  const r = start(b);
  assert.equal(r.status, 0, r.out);
  assert.equal(existsSync(b.flag), false);
});

test('the start of one agent never takes the global stop away, with or without a provider', () => {
  const b = box({ config: { active_provider: 'openai' }, tmux: true, cli: 'codex' });
  start(b, 'assistente');
  assert.equal(readFileSync(b.flag, 'utf8'), FLAG_TEXT);
});

test('startRefusal: the provider first, then, outside the container, tmux and the CLI', () => {
  const yes = () => true;
  const no = () => false;
  assert.match(startRefusal(null, { containerMode: true }), /no active provider/);
  assert.match(startRefusal({ active_provider: 'x' }, { containerMode: true }), /no active provider/);
  // in the container tmux and the CLI are the container's own: not asked on the host
  assert.equal(startRefusal({ active_provider: 'anthropic' }, { containerMode: true, hasTmux: no, hasCli: no }), null);
  assert.match(startRefusal({ active_provider: 'anthropic' }, { containerMode: false, hasTmux: no, hasCli: yes }), /tmux not found/);
  assert.match(startRefusal({ active_provider: 'anthropic' }, { containerMode: false, hasTmux: yes, hasCli: no }), /claude CLI/);
  assert.equal(startRefusal({ active_provider: 'kimi' }, { containerMode: false, hasTmux: yes, hasCli: yes }), null);
});
