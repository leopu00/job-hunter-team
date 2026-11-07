// Explicit baseline collector; execute on the attested base before freezing JSON.
// It invokes the same parsers as the source guards, without bypassing assertions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceContaining } from './source-guard-reader.mjs';
import { beginCapture } from './source-guard-provenance.mjs';
import { assertProfileFieldGuard, assertStateScriptGuard } from './source-guard-assertions.mjs';
import { PROFILE_FIELDS, CHAT_AGENTS, PROFILE_PROGRESS, TEAM_START, WORK_STATS,
  profileFields, chatAgents, profileProgress, teamStart, workStats } from './source-guard-parsers.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RUST = join(ROOT, 'desktop/src-tauri/src');
const capture = beginCapture(ROOT);
const attestedInputs = new Map();
const pythonRuntimes = new Set();
const observe = (files, runtime) => {
  if (runtime?.python) pythonRuntimes.add(runtime.python);
  files.forEach((file) => {
    const record = capture.input(file);
    attestedInputs.set(record.path, record);
  });
};

function snapshot(guard, names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return { version: 1, guard, total: names.length,
    elements: [...counts].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
      .map(([name, count]) => ({ name, count })) };
}

const sha = (text) => createHash('sha256').update(text).digest('hex');
observe([join(RUST, 'existing_team_runtime.rs')]);
const oldRuntime = readFileSync(join(RUST, 'existing_team_runtime.rs'), 'utf8');
const records = [];
const failures = [];

function captureGuard(guard, run) {
  const record = { guard };
  try {
    run(record);
    record.status = 'ok';
  } catch (error) {
    record.status = 'failed';
    record.error = String(error.message);
    failures.push(guard);
  }
  records.push(record);
}

for (const [guard, pattern, parser] of [
  ['PROFILE_FIELDS', PROFILE_FIELDS, profileFields], ['CHAT_AGENTS', CHAT_AGENTS, chatAgents],
]) {
  captureGuard(guard, (record) => {
    const before = parser(oldRuntime);
    record.before = snapshot(`${guard}.matches`, before);
    const current = sourceContaining(RUST, '.rs', pattern, observe);
    const after = parser(current);
    record.after = snapshot(`${guard}.matches`, after);
    record.inputs = { beforeSha256: sha(oldRuntime), afterSha256: sha(current) };
    assert.deepEqual(after, before, `${guard}: acquisition changed parser results`);
    assert.ok(after.length > 0, `${guard}: empty parser output`);
    if (guard === 'PROFILE_FIELDS') assertProfileFieldGuard(ROOT, observe);
    if (guard === 'CHAT_AGENTS') assertStateScriptGuard(ROOT, observe);
  });
}

for (const [guard, oldFile, script, pattern, parser] of [
  ['PROFILE_PROGRESS_PY', 'profile_progress.rs', 'profile_progress.py', PROFILE_PROGRESS, profileProgress],
  ['TEAM_START_PY', 'team_start.rs', 'team_start.py', TEAM_START, teamStart],
  ['WORK_STATS_PY', 'work_stats.rs', 'work_stats_read.py', WORK_STATS, workStats],
]) {
  captureGuard(guard, (record) => {
    observe([join(RUST, oldFile)]);
    const oldSource = readFileSync(join(RUST, oldFile), 'utf8');
    const before = parser(oldSource);
    const beforeNames = [...oldSource.matchAll(new RegExp(pattern.source, 'g'))].map(() => guard);
    record.before = snapshot(`${guard}.matches`, beforeNames);
    const current = sourceContaining(RUST, '.rs', pattern, observe);
    const after = parser(current);
    const afterNames = [...current.matchAll(new RegExp(pattern.source, 'g'))].map(() => guard);
    record.after = snapshot(`${guard}.matches`, afterNames);
    record.inputs = { beforeSha256: sha(oldSource), afterSha256: sha(current),
      script, scriptSha256: sha(after), scriptBytes: Buffer.byteLength(after) };
    assert.equal(after, before, `${guard}: parser output changed`);
    assert.ok(after.length > 0, `${guard}: empty script`);
  });
}

let provenance = capture.provenance;
try { provenance = capture.finish(); } catch (error) {
  provenance = { ...provenance, error: String(error.message) };
  failures.push('post-capture-provenance');
}
process.stdout.write(`${JSON.stringify({ version: 1, provenance: {
  ...provenance, node: process.version, python: [...pythonRuntimes].sort(),
  githubRun: process.env.GITHUB_RUN_ID ?? null, githubAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
}, valid: failures.length === 0, failures, inputs: [...attestedInputs.values()], records })}\n`);
if (failures.length) process.exitCode = 1;
