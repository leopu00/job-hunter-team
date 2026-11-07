// The original six assertions, called by both their suites and baseline capture.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PROFILE_FIELD_NAMES } from '../src/lib/existing-team-profile-digest.js';
import { CHAT_AGENTS } from '../src/lib/state-stream.js';
import { namedSource, sourceContaining } from './source-guard-reader.mjs';
import { PROFILE_FIELDS, profileFields, CHAT_AGENTS as CHAT_AGENTS_PATTERN,
  chatAgents, PROFILE_PROGRESS, profileProgress, TEAM_START, teamStart,
  WORK_STATS, workStats } from './source-guard-parsers.mjs';

export function assertProfileFieldGuard(root, observe) {
  const source = sourceContaining(join(root, 'desktop/src-tauri/src'), '.rs', PROFILE_FIELDS, observe);
  const rust = profileFields(source);
  assert.ok(rust.length > 20);
  assert.deepEqual([...PROFILE_FIELD_NAMES].sort(), [...rust].sort());
}

export function assertStateScriptGuard(root, observe) {
  const rustRoot = join(root, 'desktop/src-tauri/src');
  const skillsRoot = join(root, 'shared/skills');
  const rust = sourceContaining(rustRoot, '.rs', CHAT_AGENTS_PATTERN, observe);
  const listed = chatAgents(rust);
  assert.deepEqual(CHAT_AGENTS, listed);
  const progress = sourceContaining(rustRoot, '.rs', PROFILE_PROGRESS, observe);
  const constant = profileProgress(progress);
  assert.equal(namedSource(skillsRoot, 'profile_progress.py', observe), constant);
  const start = sourceContaining(rustRoot, '.rs', TEAM_START, observe);
  const startConstant = teamStart(start);
  assert.equal(namedSource(skillsRoot, 'team_start.py', observe), startConstant);
  const stats = sourceContaining(rustRoot, '.rs', WORK_STATS, observe);
  const statsConstant = workStats(stats);
  assert.equal(namedSource(skillsRoot, 'work_stats_read.py', observe), statsConstant);
}
