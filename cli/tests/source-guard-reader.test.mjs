import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { namedSource, sourceContaining } from './source-guard-reader.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'jht-source-guard-'));
  try { run(root); } finally { rmSync(root, { recursive: true }); }
}

test('the actual reader finds a symbol after a real move to a nested module', () => fixture((root) => {
  const text = 'pub(crate) const PROFILE_FIELDS: &[&str] = &["synthetic"];';
  writeFileSync(join(root, 'lib.rs'), 'mod runtime;');
  writeFileSync(join(root, 'runtime.rs'), text);
  const pattern = /const PROFILE_FIELDS: &\[&str\] = &\[([\s\S]*?)\];/;
  assert.equal(sourceContaining(root, '.rs', pattern), text);
  mkdirSync(join(root, 'root', 'nested'), { recursive: true });
  renameSync(join(root, 'runtime.rs'), join(root, 'root', 'nested', 'profile.rs'));
  writeFileSync(join(root, 'lib.rs'), 'mod root;');
  writeFileSync(join(root, 'root', 'mod.rs'), 'mod nested;');
  writeFileSync(join(root, 'root', 'nested', 'mod.rs'), 'mod profile;');
  assert.equal(sourceContaining(root, '.rs', pattern), text);
  writeFileSync(join(root, 'root', 'nested', 'profile.rs'), '// removed\n');
  assert.throws(() => sourceContaining(root, '.rs', pattern), /matched 0 times/);
}));

test('duplicate symbols including two in one file are refused', () => fixture((root) => {
  writeFileSync(join(root, 'lib.rs'), 'mod one;');
  writeFileSync(join(root, 'one.rs'), 'const CHAT_AGENTS: [&str; 1] = ["one"];\n'.repeat(2));
  assert.throws(() => sourceContaining(root, '.rs', /const CHAT_AGENTS:/), /matched 2 times/);
  writeFileSync(join(root, 'one.rs'), 'const CHAT_AGENTS: [&str; 1] = ["one"];');
  writeFileSync(join(root, 'two.rs'), 'const CHAT_AGENTS: [&str; 1] = ["two"];');
  writeFileSync(join(root, 'lib.rs'), 'mod one; mod two;');
  assert.throws(() => sourceContaining(root, '.rs', /const CHAT_AGENTS:/), /matched 2 times/);
}));

test('the byte reader moves with the real script, and refuses missing or duplicate scripts', () => fixture((root) => {
  writeFileSync(join(root, 'profile_progress.py'), 'print("synthetic")\n');
  const before = namedSource(root, 'profile_progress.py');
  mkdirSync(join(root, 'nested'));
  renameSync(join(root, 'profile_progress.py'), join(root, 'nested', 'profile_progress.py'));
  assert.equal(namedSource(root, 'profile_progress.py'), before);
  writeFileSync(join(root, 'profile_progress.py'), 'other\n');
  assert.throws(() => namedSource(root, 'profile_progress.py'), /found 2/);
  rmSync(join(root, 'profile_progress.py'));
  writeFileSync(join(root, 'nested', 'profile_progress.py'), '   \n');
  assert.throws(() => namedSource(root, 'profile_progress.py'), /empty source script/);
  rmSync(join(root, 'nested', 'profile_progress.py'));
  assert.throws(() => namedSource(root, 'profile_progress.py'), /found 0/);
}));
