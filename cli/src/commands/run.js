// jht run — snapshot, restore and diff of a run of the team (JHT-T355). The work is in lib/run-snapshot.js; here the words and the
// team: a snapshot stops the team first (the database is still), a restore stops it, puts the run back and starts it again.
import { Command } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { JHT_HOME, JHT_USER_DIR } from '../jht-paths.js';
import { say } from '../lib/texts.js';
import { hostWhere } from '../lib/host-where.js';
import {
  archiveRoot, diffSnapshots, listSnapshots, restoreSnapshot, takeSnapshot, LEGACY_SCHEMA,
} from '../lib/run-snapshot.js';
import { startAction } from './team/start.js';
import { stopAction } from './team/stop.js';

// the catalog test reads the keys as written: one literal key per error
const ERRORS = {
  run_name_invalid: () => say('run.error.run_name_invalid'),
  run_exists: () => say('run.error.run_exists'),
  run_not_found: () => say('run.error.run_not_found'),
  run_manual_snapshot: () => say('run.error.run_manual_snapshot'),
  run_corrupt: () => say('run.error.run_corrupt'),
  run_unlisted: () => say('run.error.run_unlisted'),
  run_stop_failed: () => say('run.error.run_stop_failed'),
};

function fail(error) {
  const code = Object.hasOwn(ERRORS, error?.message) ? error.message : 'run_failed';
  console.error(code === 'run_failed' ? say('run.error.run_failed', { detail: error?.message ?? '' }) : ERRORS[code]());
  if ((code === 'run_corrupt' || code === 'run_unlisted') && Array.isArray(error.files)) for (const f of error.files.slice(0, 10)) console.error(`  ${f}`);
  process.exitCode = 1;
}

/** The team stopped; with `assistant` the Assistente too (a restore replaces the files it reads). false when a stop failed. */
function stopTeam({ assistant = false } = {}) {
  const before = process.exitCode;
  stopAction(undefined, { all: true });
  if (assistant) stopAction('assistente', {});
  const failed = process.exitCode && process.exitCode !== before;
  if (failed) return false;
  process.exitCode = before;
  return true;
}

async function startTeam() {
  const before = process.exitCode;
  await startAction(undefined, {});
  return !(process.exitCode && process.exitCode !== before);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export async function snapshotAction(name, deps = {}) {
  try {
    const { dir, manifest } = await takeSnapshot({
      name, home: deps.home ?? JHT_HOME, userDir: deps.userDir ?? JHT_USER_DIR, root: deps.root ?? archiveRoot(),
      stopTeam: deps.stopTeam ?? (() => stopTeam()), where: deps.where ?? (() => hostWhere()),
      version: pkg.version, pin: process.env.JHT_PIN || null,
    });
    const bytes = manifest.files.reduce((a, f) => a + f.bytes, 0);
    const s = manifest.secrets_left_out;
    console.log(say('run.snapshot.done', { name, path: dir, files: String(manifest.files.length), size: mb(bytes) }));
    console.log(say('run.snapshot.secrets', { n: String(s.files + s.folders + s.values + s.db_columns) }));
    console.log(say('run.snapshot.stopped'));
  } catch (error) { fail(error); }
}

export async function restoreAction(name, options = {}, deps = {}) {
  try {
    const { kept, started } = await restoreSnapshot({
      name, fresh: Boolean(options.fresh), home: deps.home ?? JHT_HOME, userDir: deps.userDir ?? JHT_USER_DIR,
      root: deps.root ?? archiveRoot(), stopTeam: deps.stopTeam ?? (() => stopTeam({ assistant: true })),
      startTeam: deps.startTeam ?? startTeam, version: pkg.version,
    });
    if (kept) console.log(say('run.restore.kept', { path: kept }));
    if (options.fresh) console.log(say('run.restore.done_fresh', { name }));
    else console.log(say('run.restore.done', { name }));
    if (!started) {
      console.log(say('run.restore.not_started'));
      process.exitCode = 1;
    }
  } catch (error) { fail(error); }
}

const ROWS = [
  ['positions_found', (m) => m.positions_found],
  ['evaluated_offers', (m) => m.evaluated_offers],
  ['useful_positions', (m) => m.useful_positions],
  ['spend_usd', (m) => m.spend_usd],
  ['cost_per_evaluated_offer', (m) => m.cost_per_evaluated_offer],
  ['cost_per_useful_position', (m) => m.cost_per_useful_position],
  ['ai_calls', (m) => m.ai_calls],
  ['tokens', (m) => m.tokens.input + m.tokens.output + m.tokens.cache_write],
  ['minutes_per_run', (m) => m.minutes_per_run],
  ['minutes_to_first_evaluated_offer', (m) => m.minutes_to_first_evaluated_offer],
  ['relevance_mean_score', (m) => m.quality.relevance_mean_score],
  ['score_stddev', (m) => m.quality.score_stddev],
  ['critic_pass', (m) => m.quality.critic_verdicts.pass],
];

export async function diffAction(a, b, options = {}, deps = {}) {
  try {
    const diff = await diffSnapshots(a, b, deps.root ?? archiveRoot());
    if (options.json) { console.log(JSON.stringify(diff, null, 2)); return; }
    const show = (v) => (v === null || v === undefined ? '—' : String(v));
    const width = Math.max(...ROWS.map(([k]) => k.length));
    console.log(`${''.padEnd(width)}  ${a.padEnd(14)}  ${b}`);
    for (const [key, pick] of ROWS) console.log(`${key.padEnd(width)}  ${show(pick(diff.a)).padEnd(14)}  ${show(pick(diff.b))}`);
    const r = diff.replica;
    console.log(say('run.diff.overlap', {
      urls: String(r.url_overlap.shared), jaccard: show(r.url_overlap.jaccard), companies: String(r.company_overlap.shared),
      fresh: String(r.positions_new_in_b), delta: show(r.score_delta_mean_abs),
    }));
  } catch (error) { fail(error); }
}

export function listAction(deps = {}) {
  const runs = listSnapshots(deps.root ?? archiveRoot());
  if (!runs.length) { console.log(say('run.list.none')); return; }
  for (const { name, manifest } of runs) {
    const kind = manifest.schema === LEGACY_SCHEMA ? say('run.list.manual') : '';
    console.log(`  ${name}  ${manifest.created_at ?? '?'}${kind ? `  ${kind}` : ''}`);
  }
}

export function registerRunCommand(program) {
  const run = new Command('run').description(say('run.help.description'));
  run.command('snapshot <name>').description(say('run.help.snapshot')).action((name) => snapshotAction(name));
  run.command('restore <name>').description(say('run.help.restore'))
    .option('--fresh', say('run.help.fresh'))
    .action((name, options) => restoreAction(name, options));
  run.command('diff <a> <b>').description(say('run.help.diff'))
    .option('--json', say('option.json'))
    .action((a, b, options) => diffAction(a, b, options));
  run.command('list').description(say('run.help.list')).action(() => listAction());
  program.addCommand(run);
}
