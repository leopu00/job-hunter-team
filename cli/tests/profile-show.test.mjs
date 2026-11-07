import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  afterEach, test,
} from 'node:test';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MAX_PROFILE_BYTES } from '../src/lib/profile-import.js';

const CLI = resolve(import.meta.dirname, '../bin/jht.js');
const PROFILE = {
  name: 'Synthetic Candidate', email: 'candidate@example.invalid',
  target_role: 'Backend Engineer', location: 'Example City', experience_years: 4,
  seniority_target: 'mid', skills: { primary: ['Python', 'SQL'] },
  languages: [{ language: 'English', level: 'C1' }],
  custom: { note: 'Synthetic notes', enabled: false, count: 0 },
};
const roots = [];

function fixture(body = JSON.stringify(PROFILE)) {
  const root = mkdtempSync(join(tmpdir(), 'jht-profile-show-'));
  roots.push(root);
  const home = join(root, 'jht-home');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const log = join(root, 'forbidden.log');
  for (const command of ['tmux', 'docker', 'podman', 'ssh', 'codex', 'claude', 'kimi']) {
    const file = join(bin, command);
    writeFileSync(file, '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$JHT_SHOW_FORBIDDEN_LOG"\nexit 99\n');
    chmodSync(file, 0o755);
  }
  const profile = join(home, 'profile', 'candidate_profile.yml');
  if (body !== null) {
    mkdirSync(join(home, 'profile'), { recursive: true });
    writeFileSync(profile, body);
  }
  return { root, home, bin, profile, log };
}

function snapshot(root) {
  const entries = [];
  for (const name of readdirSync(root).sort()) {
    const file = join(root, name);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) entries.push([name, 'link', readlinkSync(file)]);
    else if (stat.isDirectory()) entries.push([name, 'dir', snapshot(file)]);
    else entries.push([name, stat.mode, stat.mtimeMs, createHash('sha256').update(readFileSync(file)).digest('hex')]);
  }
  return entries;
}

function run(f, args = ['profile', 'show', '--json'], lang = 'en') {
  const before = snapshot(f.root);
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', timeout: 10_000,
    env: {
      ...process.env, JHT_HOME: f.home, JHT_USER_DIR: join(f.root, 'documents'),
      HOME: join(f.root, 'os-home'), USERPROFILE: join(f.root, 'os-home'), JHT_LANG: lang,
      PATH: `${f.bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
      NO_COLOR: '1', JHT_SHOW_FORBIDDEN_LOG: f.log,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(existsSync(f.log), false, 'a read-only command must not ask an engine, agent or tmux');
  assert.deepEqual(snapshot(f.root), before, 'no profile, flag, configuration or temporary file may be written');
  return result;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('shows the actual complete saved profile, including unknown fields, booleans and zero', () => {
  const f = fixture();
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true, state: 'complete', code: 'profile_complete', profile: PROFILE, missing: [],
  });
});

test('reads real YAML, nested fields and an unquoted date', () => {
  const text = readFileSync(resolve(import.meta.dirname, 'fixtures/profile-synthetic.yml'), 'utf8');
  const result = run(fixture(`${text}\nnotes: Synthetic notes\nbirth_date: 2000-01-02\n`));
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.profile.candidate.contacts.email, 'candidate@example.invalid');
  assert.equal(value.profile.birth_date, '2000-01-02');
  assert.equal(value.profile.notes, 'Synthetic notes');
});

test('uses the canonical minimum for nested saved profiles without rewriting their shape', () => {
  const profile = {
    candidate: { name: PROFILE.name, target_role: PROFILE.target_role, contacts: { email: PROFILE.email },
      skills: PROFILE.skills, languages: PROFILE.languages },
    personal: { location: PROFILE.location }, positioning: { seniority_target: PROFILE.seniority_target },
    experience_years: PROFILE.experience_years,
  };
  const result = run(fixture(JSON.stringify(profile)));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).profile, profile);
  assert.deepEqual(JSON.parse(result.stdout).missing, []);
});

test('refuses nested YAML keys that would collide or change when represented as JSON', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'fixtures/profile-synthetic.yml'), 'utf8');
  for (const extra of ["custom: {1: numeric, '1': text}", "custom: [{1: numeric, '1': text}]"]) {
    const result = run(fixture(`${source}\n${extra}\n`));
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false, state: 'unreadable', code: 'profile_unreadable', profile: null,
    });
  }
});

const LANGUAGES = {
  en: ['Saved profile', 'Show the saved profile'],
  it: ['Profilo salvato', 'Mostra il profilo salvato'],
  de: ['Gespeichertes Profil', 'Gespeichertes Profil anzeigen'],
  es: ['Perfil guardado', 'Mostrar el perfil guardado'],
  fr: ['Profil enregistré', 'Afficher le profil enregistré'],
  hu: ['Mentett profil', 'A mentett profil megjelenítése'],
  pt: ['Perfil guardado', 'Mostrar o perfil guardado'],
};
for (const [lang, [title, help]] of Object.entries(LANGUAGES)) {
  test(`human output and help use the ${lang} catalog, while JSON preserves the saved data`, () => {
    const f = fixture();
    const human = run(f, ['profile', 'show'], lang);
    assert.equal(human.status, 0, human.stderr);
    assert.ok(human.stdout.includes(title));
    assert.ok(human.stdout.includes('Synthetic Candidate'));
    assert.ok(human.stdout.includes('Synthetic notes'));
    assert.ok(human.stdout.includes('false') && human.stdout.includes('0'));
    const usage = run(f, ['profile', '--help'], lang);
    assert.equal(usage.status, 0, usage.stderr);
    assert.ok(usage.stdout.includes('show') && usage.stdout.includes(help));
    assert.deepEqual(JSON.parse(run(f, undefined, lang).stdout).profile, PROFILE);
  });
}

test('a readable but incomplete profile is shown with its missing fields and a distinct exit code', () => {
  const f = fixture('name: Synthetic Candidate\n');
  writeFileSync(join(f.home, 'profile', 'ready.flag'), 'synthetic stale flag\n');
  const result = run(f);
  assert.equal(result.status, 3);
  const value = JSON.parse(result.stdout);
  assert.equal(value.code, 'profile_incomplete');
  assert.equal(value.state, 'incomplete');
  assert.deepEqual(value.profile, { name: 'Synthetic Candidate' });
  assert.ok(value.missing.includes('email') && !value.missing.includes('name'));
  const human = run(f, ['profile', 'show']);
  assert.equal(human.status, 3);
  assert.ok(human.stdout.includes('Missing fields:') && human.stdout.includes('Synthetic Candidate'));
});

test('an existing empty profile is incomplete, not absent', () => {
  const result = run(fixture(''));
  assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stdout).code, 'profile_incomplete');
});

test('a missing profile is absent and does not create the home or a profile', () => {
  const f = fixture(null);
  const result = run(f);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, state: 'absent', code: 'profile_absent', profile: null });
  const human = run(f, ['profile', 'show']);
  assert.equal(human.status, 1);
  assert.ok(human.stderr.includes('[profile_absent]'));
  assert.equal(existsSync(f.home), false);
});

for (const [label, body] of [
  ['invalid YAML', 'name: [unterminated\n'],
  ['a scalar', 'not a profile\n'],
  ['invalid UTF-8', Buffer.from([0xff, 0xfe])],
  ['a recursive alias', 'candidate: &candidate {loop: *candidate}\n'],
  ['an oversized file', Buffer.alloc(MAX_PROFILE_BYTES + 1, 32)],
]) {
  test(`${label} is unreadable and never becomes an empty profile`, () => {
    const result = run(fixture(body));
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false, state: 'unreadable', code: 'profile_unreadable', profile: null,
    });
  });
}

test('refuses a directory or symlink at the profile path', () => {
  for (const kind of ['directory', 'symlink']) {
    const f = fixture();
    rmSync(f.profile);
    if (kind === 'directory') mkdirSync(f.profile);
    else {
      const target = join(f.root, 'other.yml');
      writeFileSync(target, JSON.stringify(PROFILE));
      symlinkSync(target, f.profile);
    }
    const result = run(f);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).code, 'profile_unreadable');
  }
});

test('a reader that cannot run is explicit, not a missing or empty profile', () => {
  const f = fixture();
  const python = join(f.bin, 'python3');
  writeFileSync(python, '#!/bin/sh\nexit 127\n');
  chmodSync(python, 0o755);
  const result = run(f);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, 'profile_reader_unavailable');
});

test('an unreadable saved profile does not fall back to the previous profile', () => {
  const f = fixture('name: [invalid\n');
  writeFileSync(`${f.profile}.prev`, JSON.stringify(PROFILE));
  const result = run(f);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).profile, null);
  assert.equal(JSON.parse(result.stdout).code, 'profile_unreadable');
});

test('human output escapes terminal control characters while JSON retains the saved string', () => {
  const f = fixture(JSON.stringify({ ...PROFILE, notes: '\u001b[2JSynthetic note' }));
  const human = run(f, ['profile', 'show']);
  assert.equal(human.status, 0, human.stderr);
  assert.equal(human.stdout.includes('\u001b'), false);
  assert.ok(human.stdout.includes('\\u001b[2JSynthetic note'));
  assert.equal(JSON.parse(run(f).stdout).profile.notes, '\u001b[2JSynthetic note');
});
