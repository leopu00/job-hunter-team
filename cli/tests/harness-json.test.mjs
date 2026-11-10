import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `jht providers harness [name] --json`: the one JSON line the desktop app reads, and the closed codes of a refusal.
const entry = join(fileURLToPath(new URL('..', import.meta.url)), 'bin/jht.js');

function box(config) {
  const home = join(mkdtempSync(join(tmpdir(), 'jht-harness-json-')), '.jht');
  mkdirSync(home, { recursive: true });
  if (config !== undefined) writeFileSync(join(home, 'jht.config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return home;
}

function jht(home, args) {
  const r = spawnSync(process.execPath, [entry, 'providers', 'harness', ...args, '--json'], {
    env: { PATH: dirname(process.execPath), HOME: dirname(home), JHT_HOME: home, NO_COLOR: '1' }, encoding: 'utf8', timeout: 30_000,
  });
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  return { status: r.status, lines, reply: lines.length ? JSON.parse(lines[lines.length - 1]) : null, stderr: r.stderr };
}

const OPENAI = { version: 1, active_provider: 'openai', providers: { openai: { name: 'openai', auth_method: 'subscription' } }, channels: {} };

test('the read is one JSON line: the harness, whether pi is allowed, and the login that counts', () => {
  const home = box(OPENAI);
  const r = jht(home, []);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(r.reply, { ok: true, harness: 'codex', changed: false, provider: 'openai', pi_allowed: true, login: 'signed_out' });
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex/auth.json'), '{}');
  assert.equal(jht(home, []).reply.login, 'signed_in');
});

test('choosing pi writes the key and the login becomes Pi\'s own', () => {
  const home = box(OPENAI);
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex/auth.json'), '{}');
  const set = jht(home, ['pi']);
  assert.equal(set.status, 0, set.stderr);
  assert.deepEqual(set.reply, { ok: true, harness: 'pi', changed: true, provider: 'openai', pi_allowed: true, login: 'signed_out' });
  assert.equal(JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8')).harness, 'pi');
  mkdirSync(join(home, '.pi/agent'), { recursive: true });
  writeFileSync(join(home, '.pi/agent/auth.json'), '{"openai":{"type":"oauth","secret":"never printed"}}');
  const again = jht(home, ['pi']);
  assert.equal(again.reply.changed, false);
  assert.equal(again.reply.login, 'signed_in');
  assert.doesNotMatch(again.lines.join('\n'), /never printed/);
});

test('with Pi the login is the one of the provider of the setup: a file with only Anthropic is signed out, and no value is printed', () => {
  const home = box({ ...OPENAI, harness: 'pi' });
  mkdirSync(join(home, '.pi/agent'), { recursive: true });
  writeFileSync(join(home, '.pi/agent/auth.json'), '{"anthropic":{"type":"oauth","secret":"never printed"}}');
  const r = jht(home, []);
  assert.equal(r.reply.login, 'signed_out');
  assert.doesNotMatch(r.lines.join('\n'), /never printed/);
  for (const [text, login] of [['{"openai-codex":{"type":"oauth"}}', 'signed_in'], ['{}', 'signed_out'], ['not json', 'signed_out'], ['{"openai":{}}', 'signed_out']]) {
    writeFileSync(join(home, '.pi/agent/auth.json'), text);
    assert.equal(jht(home, []).reply.login, login, text);
  }
  // a provider this release has no entry name for keeps the rule of before: the file is there
  const other = box({ version: 1, active_provider: 'zzz', harness: 'pi', providers: { zzz: { name: 'zzz', auth_method: 'subscription' } }, channels: {} });
  mkdirSync(join(other, '.pi/agent'), { recursive: true });
  writeFileSync(join(other, '.pi/agent/auth.json'), '{"anthropic":{}}');
  assert.notEqual(jht(other, []).reply.login, 'signed_in', 'zzz is not a provider that runs on pi');
});

test('a marker that is a link is not a login', () => {
  const home = box({ ...OPENAI, harness: 'pi' });
  mkdirSync(join(home, '.pi/agent'), { recursive: true });
  writeFileSync(join(home, 'elsewhere.json'), '{}');
  symlinkSync(join(home, 'elsewhere.json'), join(home, '.pi/agent/auth.json'));
  assert.equal(jht(home, []).reply.login, 'unknown');
});

test('an API key needs no login, and a provider pi cannot start on is not allowed', () => {
  const key = jht(box({ version: 1, active_provider: 'glm', harness: 'pi', providers: { glm: { name: 'glm', auth_method: 'api_key' } }, channels: {} }), []);
  assert.equal(key.reply.login, 'not_needed');
  assert.equal(key.reply.pi_allowed, true);
  const claude = jht(box({ version: 1, active_provider: 'claude', providers: { claude: { name: 'claude', auth_method: 'subscription' } }, channels: {} }), []);
  assert.equal(claude.reply.pi_allowed, false);
  assert.equal(claude.reply.harness, 'codex');
});

test('every refusal is a closed code with exit 1, and the config is not touched', () => {
  const claudeText = JSON.stringify({ version: 1, active_provider: 'claude', providers: { claude: { name: 'claude', auth_method: 'subscription' } }, channels: {} });
  const claude = box(claudeText);
  const refused = jht(claude, ['pi']);
  assert.equal(refused.status, 1);
  assert.deepEqual(refused.reply, { ok: false, error: 'harness_refused' });
  assert.equal(readFileSync(join(claude, 'jht.config.json'), 'utf8'), claudeText);
  assert.equal(jht(box(OPENAI), ['opencode']).reply.error, 'harness_unrecognized');
  assert.equal(jht(box(), ['pi']).reply.error, 'harness_no_provider');
  assert.equal(jht(box('{not json'), []).reply.error, 'harness_config_unreadable');
  assert.equal(jht(box({ ...OPENAI, harness: 'opencode' }), []).reply.error, 'harness_value_invalid');
  for (const r of [jht(box(OPENAI), ['opencode']), jht(box('[]'), [])]) assert.equal(r.status, 1);
});
