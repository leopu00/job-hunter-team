import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sourceContaining, namedSource } from './source-guard-reader.mjs';
import { PROFILE_FIELDS, CHAT_AGENTS, PROFILE_PROGRESS, TEAM_START, WORK_STATS,
  profileFields, chatAgents, profileProgress, teamStart, workStats } from './source-guard-parsers.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'jht-real-parser-'));
  try { run(root); } finally { rmSync(root, { recursive: true }); }
}

test('the real field parser keeps multiplicities after a move and exposes a lost field', () => fixture((root) => {
  const fields = [...Array(22).fill('alpha'), 'beta'];
  const body = (names) => `const PROFILE_FIELDS: &[&str] = &[${names.map((name) => `"${name}"`).join(',')}];`;
  const original = join(root, 'existing_team_runtime.rs');
  writeFileSync(join(root, 'lib.rs'), 'mod existing_team_runtime;');
  writeFileSync(original, body(fields));
  const acquired = () => profileFields(sourceContaining(root, '.rs', PROFILE_FIELDS));
  assert.ok(acquired().length > 20);
  assert.deepEqual(acquired(), fields);
  mkdirSync(join(root, 'existing_team_runtime', 'root'), { recursive: true });
  const moved = join(root, 'existing_team_runtime', 'root', 'profile.rs');
  renameSync(original, moved);
  writeFileSync(original, 'mod root;\n');
  writeFileSync(join(root, 'existing_team_runtime', 'root.rs'), 'mod profile;');
  assert.deepEqual(acquired(), fields);
  writeFileSync(moved, body(fields.slice(1)));
  assert.ok(acquired().length > 20, 'the old threshold alone still passes');
  assert.throws(() => assert.deepEqual(acquired(), fields), assert.AssertionError);
}));

test('the real chat parser finds chat_commands.rs below root and loses no agent', () => fixture((root) => {
  const expected = ['alpha', 'beta', 'gamma'];
  const original = join(root, 'existing_team_runtime.rs');
  writeFileSync(join(root, 'lib.rs'), 'mod existing_team_runtime;');
  writeFileSync(original, 'const CHAT_AGENTS: [&str; 3] = ["alpha", "beta", "gamma"];');
  const acquired = () => chatAgents(sourceContaining(root, '.rs', CHAT_AGENTS));
  assert.deepEqual(acquired(), expected);
  mkdirSync(join(root, 'existing_team_runtime', 'root'), { recursive: true });
  const moved = join(root, 'existing_team_runtime', 'root', 'chat_commands.rs');
  renameSync(original, moved);
  writeFileSync(original, 'mod root;\n');
  writeFileSync(join(root, 'existing_team_runtime', 'root.rs'), 'mod chat_commands;');
  assert.deepEqual(acquired(), expected);
  writeFileSync(moved, 'const CHAT_AGENTS: [&str; 2] = ["alpha", "beta"];');
  assert.throws(() => assert.deepEqual(acquired(), expected), assert.AssertionError);
}));

for (const [name, file, pattern, parser] of [
  ['PROFILE_PROGRESS_PY', 'profile_progress.py', PROFILE_PROGRESS, profileProgress],
  ['TEAM_START_PY', 'team_start.py', TEAM_START, teamStart],
  ['WORK_STATS_PY', 'work_stats_read.py', WORK_STATS, workStats],
]) {
  test(`${name}: the real byte parser survives nested moves and rejects missing definitions`, () => fixture((root) => {
    const script = 'print("synthetic")\n';
    const original = join(root, 'source.rs');
    writeFileSync(join(root, 'lib.rs'), 'mod source;');
    writeFileSync(original, `const ${name}: &str = r#"${script}"#;`);
    writeFileSync(join(root, file), script);
    const acquired = () => parser(sourceContaining(root, '.rs', pattern));
    assert.equal(namedSource(root, file), acquired());
    mkdirSync(join(root, 'nested'));
    renameSync(original, join(root, 'nested', 'commands.rs'));
    renameSync(join(root, file), join(root, 'nested', file));
    writeFileSync(join(root, 'lib.rs'), 'mod nested;');
    writeFileSync(join(root, 'nested', 'mod.rs'), 'mod commands;');
    assert.equal(namedSource(root, file), acquired());
    writeFileSync(join(root, 'nested', 'commands.rs'), '// definition removed\n');
    assert.throws(acquired, /matched 0 times/);
  }));
}

test('a comment, raw literal, cfg(test) item and orphan cannot replace a production declaration', () => fixture((root) => {
  const fake = 'const PROFILE_FIELDS: &[&str] = &["fake"];';
  writeFileSync(join(root, 'lib.rs'), `// ${fake}\nconst DOC: &str = r#"${fake}"#;\n#[cfg(test)] ${fake}\n`);
  writeFileSync(join(root, 'orphan.rs'), fake);
  assert.throws(() => sourceContaining(root, '.rs', PROFILE_FIELDS), /matched 0 times/);
  const real = 'const PROFILE_FIELDS: &[&str] = &["real"];';
  writeFileSync(join(root, 'lib.rs'), `// ${fake}\nconst DOC: &str = r#"${fake}"#;\n${real}\n`);
  assert.deepEqual(profileFields(sourceContaining(root, '.rs', PROFILE_FIELDS)), ['real']);
}));

test('the byte parser preserves CRLF inside the selected real raw literal', () => fixture((root) => {
  const script = 'print("first")\r\nprint("second")\r\n';
  const real = `const PROFILE_PROGRESS_PY: &str = r#"${script}"#;`;
  writeFileSync(join(root, 'lib.rs'), `\ufeff// const PROFILE_PROGRESS_PY: &str = r#"fake"#;\r\n${real}\r\n`);
  assert.equal(profileProgress(sourceContaining(root, '.rs', PROFILE_PROGRESS)), script);
}));
