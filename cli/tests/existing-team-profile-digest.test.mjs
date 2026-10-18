import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { digestProfileResult, PROFILE_FIELD_NAMES } from '../src/lib/existing-team-profile-digest.js';

// `jht existing-team profile --digest` prints facts about the profile and no
// value of it. Everything below is synthetic: the "values" are markers so that
// their ABSENCE from the output can be asserted.
const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'bin', 'jht.js');
const PROFILE_ID = 'a'.repeat(64);
const SHA_A = 'a1'.repeat(32);
const SHA_B = 'b2'.repeat(32);

const MARKERS = [
  'SYNTHETIC-VALUE-NAME', 'SYNTHETIC-VALUE-ROLE', 'SYNTHETIC-VALUE-PHONE', 'SYNTHETIC-VALUE-NOTE',
  'SYNTHETIC-VALUE-SKILL', 'SYNTHETIC-VALUE-SUMMARY-TEXT', 'SYNTHETIC-VALUE-OTHER-TEXT',
  'synthetic-personal-summary-name', 'SYNTHETIC-VALUE-ERROR-TEXT', 'SYNTHETIC-VALUE-EXTRA',
];

const reply = () => ({
  ok: true, phase: 'read', code: 0,
  data: {
    profile: {
      state: 'ok', bytes: 900, sha256: SHA_A, parse: 'ok', kept: 5, dropped: 2,
      fields: {
        name: 'SYNTHETIC-VALUE-NAME',
        target_role: 'SYNTHETIC-VALUE-ROLE',
        skills: { primary: ['SYNTHETIC-VALUE-SKILL'] },
        has_degree: true,
        experience_years: 17,
        birth_year: null,
        notes: 'SYNTHETIC-VALUE-NOTE',
        candidate: { contacts: { phone: 'SYNTHETIC-VALUE-PHONE' } },
      },
      text: 'SYNTHETIC-VALUE-EXTRA',
    },
    summaries: {
      state: 'ok', included: 2, of: 3,
      items: [
        { name: 'about', state: 'ok', bytes: 40, sha256: SHA_B, text: 'SYNTHETIC-VALUE-SUMMARY-TEXT' },
        { name: 'synthetic-personal-summary-name', state: 'ok', bytes: 21, sha256: SHA_A, text: 'SYNTHETIC-VALUE-OTHER-TEXT' },
        { name: 'goals', state: 'too_large', bytes: 40000, extra: 'SYNTHETIC-VALUE-EXTRA' },
      ],
    },
    extra: 'SYNTHETIC-VALUE-EXTRA',
  },
  extra: 'SYNTHETIC-VALUE-EXTRA',
});

function assertNoMarker(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  for (const marker of MARKERS) assert.ok(!text.includes(marker), `the digest carries ${marker}`);
}

test('the digest keeps the envelope, the states, counts, lengths and hashes, and no value', () => {
  const { code, value } = digestProfileResult({ code: 0, value: reply() });
  assert.equal(code, 0);
  assertNoMarker(value);
  assert.deepEqual(value.data.profile, {
    state: 'ok', parse: 'ok', bytes: 900, sha256: SHA_A, kept: 5, dropped: 2,
    fields: [
      { name: 'birth_year', kind: 'null', length: null },
      { name: 'candidate', kind: 'object', length: JSON.stringify({ contacts: { phone: 'SYNTHETIC-VALUE-PHONE' } }).length },
      { name: 'experience_years', kind: 'number', length: null },
      { name: 'has_degree', kind: 'boolean', length: null },
      { name: 'name', kind: 'string', length: JSON.stringify('SYNTHETIC-VALUE-NAME').length },
      { name: 'notes', kind: 'string', length: JSON.stringify('SYNTHETIC-VALUE-NOTE').length },
      { name: 'skills', kind: 'object', length: JSON.stringify({ primary: ['SYNTHETIC-VALUE-SKILL'] }).length },
      { name: 'target_role', kind: 'string', length: JSON.stringify('SYNTHETIC-VALUE-ROLE').length },
    ],
  });
  assert.deepEqual({ ok: value.ok, phase: value.phase, code: value.code, digest: value.digest }, { ok: true, phase: 'read', code: 0, digest: true });
  // a boolean's or a number's length would be its value: it is not given
  assert.deepEqual(value.data.profile.fields.filter((field) => ['boolean', 'number', 'null'].includes(field.kind)).map((field) => field.length), [null, null, null]);
  assert.equal(value.data.summaries.included, 2);
  assert.equal(value.data.summaries.of, 3);
});

test('a summary name is kept only if it is one of the four conventional ones, otherwise it is a hash', () => {
  const { value } = digestProfileResult({ code: 0, value: reply() });
  const items = value.data.summaries.items;
  assert.equal(items[0].name, 'about');
  assert.match(items[1].name, /^h:[0-9a-f]{12}$/);
  assert.equal(items[2].name, 'goals');
  assert.deepEqual(items[0], { name: 'about', state: 'ok', bytes: 40, sha256: SHA_B, length: 'SYNTHETIC-VALUE-SUMMARY-TEXT'.length });
  assert.deepEqual(items[2], { name: 'goals', state: 'too_large', bytes: 40000, sha256: null, length: null });
  // the same name hashes to the same id, so two runs can be compared
  assert.equal(digestProfileResult({ code: 0, value: reply() }).value.data.summaries.items[1].name, items[1].name);
});

test('a field name the core does not whitelist is hashed, not printed', () => {
  const raw = reply();
  raw.data.profile.fields = { 'synthetic-personal-summary-name': 'x', name: 'y' };
  const { value } = digestProfileResult({ code: 0, value: raw });
  assert.deepEqual(value.data.profile.fields.map((field) => field.name).sort(), [expectedHash(), 'name'].sort());
  assertNoMarker(value);
});

function expectedHash() {
  return digestProfileResult({ code: 0, value: (() => { const r = reply(); r.data.profile.fields = { 'synthetic-personal-summary-name': 'x' }; return r; })() }).value.data.profile.fields[0].name;
}

test('a failed reply keeps its codes only, and a text that is not a code is dropped', () => {
  const failed = digestProfileResult({ code: 69, value: { ok: false, phase: 'read', code: 69, error: 'positions_unavailable', detail: 'SYNTHETIC-VALUE-ERROR-TEXT' } });
  assert.deepEqual(failed, { code: 69, value: { ok: false, phase: 'read', code: 69, error: 'positions_unavailable', digest: true } });
  const odd = digestProfileResult({ code: 69, value: { ok: false, phase: 'SYNTHETIC-VALUE-ERROR-TEXT', code: 69, error: 'SYNTHETIC-VALUE-ERROR-TEXT' } });
  assertNoMarker(odd.value);
  assert.equal(odd.value.error, null);
  assert.equal(odd.value.phase, null);
});

test('a reply that is ok but is not the profile shape is an invalid reply, never passed through', () => {
  const whole = reply().data;
  for (const value of [
    { ok: true, phase: 'read', code: 0 },
    { ok: true, phase: 'read', code: 0, data: { items: ['SYNTHETIC-VALUE-EXTRA'] } },
    { ok: true, phase: 'read', code: 0, data: { summaries: whole.summaries } },
    { ok: true, phase: 'read', code: 0, data: { profile: whole.profile } },
    { ok: true, phase: 'read', code: 0, data: { profile: whole.profile, summaries: { ...whole.summaries, items: 'SYNTHETIC-VALUE-EXTRA' } } },
    null,
    'SYNTHETIC-VALUE-EXTRA',
  ]) {
    const out = digestProfileResult({ code: 0, value });
    assert.deepEqual(out, { code: 69, value: { ok: false, phase: 'adapter', code: 69, error: 'existing_team_adapter_invalid_reply' } });
  }
});

test('values of the wrong type become null or unknown instead of travelling', () => {
  const raw = reply();
  Object.assign(raw.data.profile, { state: 'SYNTHETIC-VALUE-EXTRA', parse: 'SYNTHETIC-VALUE-EXTRA', bytes: 'SYNTHETIC-VALUE-EXTRA', sha256: 'SYNTHETIC-VALUE-EXTRA', kept: -1, dropped: 1.5 });
  const { value } = digestProfileResult({ code: 0, value: raw });
  assert.deepEqual({ ...value.data.profile, fields: undefined }, { state: 'unknown', parse: 'unknown', bytes: null, sha256: null, kept: null, dropped: null, fields: undefined });
  assertNoMarker(value);
});

test('the field names it knows are the ones the core keeps (Rust PROFILE_FIELDS)', () => {
  const source = readFileSync(join(HERE, '..', '..', 'desktop', 'src-tauri', 'src', 'existing_team_runtime.rs'), 'utf8');
  const block = /const PROFILE_FIELDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
  const rust = [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(rust.length > 20);
  assert.deepEqual([...PROFILE_FIELD_NAMES].sort(), [...rust].sort());
});

// The command itself, with a companion that answers a synthetic profile.
function runCommand(args) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-digest-'));
  try {
    const companion = join(dir, 'fake-companion');
    writeFileSync(companion, `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(reply()))}));\n`);
    chmodSync(companion, 0o700);
    const run = spawnSync(process.execPath, [BIN, 'existing-team', 'profile', '--profile', PROFILE_ID, ...args], {
      encoding: 'utf8', env: { PATH: process.env.PATH, JHT_EXISTING_TEAM_COMPANION: companion, HOME: dir },
    });
    return run;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('with --digest the command prints no value of the profile, on stdout or stderr', () => {
  const run = runCommand(['--digest']);
  assert.equal(run.status, 0, run.stderr);
  assertNoMarker(run.stdout);
  assertNoMarker(run.stderr);
  const printed = JSON.parse(run.stdout);
  assert.equal(printed.digest, true);
  assert.equal(printed.data.profile.sha256, SHA_A);
  assert.equal(printed.data.profile.fields.length, 8);
});

test('without --digest the output is the profile itself, and the help says so', () => {
  const run = runCommand([]);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('SYNTHETIC-VALUE-NAME'));
  assert.ok(!JSON.parse(run.stdout).digest);
  const help = spawnSync(process.execPath, [BIN, 'existing-team', 'profile', '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmpdir() } });
  assert.match(help.stdout, /--digest/);
  assert.match(help.stdout, /personal data/);
});
