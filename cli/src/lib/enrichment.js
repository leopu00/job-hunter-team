/**
 * The switches of the Analisti's enrichments (enrichment-policy.json): what the team does on its own to complete a position,
 * the company logo, the office on the map, the recheck of the live positions.
 *
 * The rules live in shared/skills/enrichment_policy.py, the one writer of the file: `show` reads it, `apply` takes one JSON
 * object of switches and typed values on stdin and writes all of them or none. Here only what a person types (on, off, a
 * number, none) becomes a typed value, and the answer becomes lines in the person's language. `jht enrichment` and the
 * desktop (through `jht team-settings`) use these same lists.
 */
import { say } from './texts.js';

/** Every switch: [key of the policy, kind of value]. The order is the order they are shown in. */
export const SWITCHES = Object.freeze([
  ['economy', 'bool'],
  ['logo.enabled', 'bool'],
  ['logo.min_score', 'score_or_null'],
  ['geocode_pipeline.enabled', 'bool'],
  ['geocode_missing.enabled', 'bool'],
  ['geocode_missing.min_score', 'score_or_null'],
  ['geocode_missing.non_remote_only', 'bool'],
  ['recheck_weekly.enabled', 'bool'],
  ['recheck_weekly.min_score', 'score'],
  ['recheck_weekly.older_than_days', 'days'],
]);

const KIND = new Map(SWITCHES);
export const SWITCH_KEYS = Object.freeze(SWITCHES.map(([key]) => key));
/** The closed refusals of `apply`, and the two of this side. */
export const REFUSALS = Object.freeze(['request_invalid', 'key_unknown', 'value_invalid', 'write_failed', 'policy_unavailable']);

const ON = new Set(['on', 'true', 'yes', '1']);
const OFF = new Set(['off', 'false', 'no', '0']);
const NONE = new Set(['none', 'null', '']);

/** A JSON value of `key` (from the app, from the skill), valid for its kind, or undefined. No words, no conversions. */
export function jsonValue(key, value) {
  const kind = KIND.get(key);
  if (!kind) return undefined;
  if (kind === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (value === null) return kind === 'score_or_null' ? null : undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (kind === 'days') return value >= 1 && value <= 365 ? value : undefined;
  return value >= 0 && value <= 100 ? value : undefined;
}

/** What a person typed for `key` (on, off, a number, none) as a typed value, or undefined. */
export function typedValue(key, raw) {
  const kind = KIND.get(key);
  if (!kind || typeof raw !== 'string') return kind ? jsonValue(key, raw) : undefined;
  const word = raw.trim().toLowerCase();
  if (kind === 'bool') return ON.has(word) ? true : OFF.has(word) ? false : undefined;
  if (NONE.has(word)) return kind === 'score_or_null' ? null : undefined;
  return /^\d{1,3}$/.test(word) ? jsonValue(key, Number(word)) : undefined;
}

/** A request for `apply`: every value typed and valid, or null when one is not. Unknown keys are null too. */
export function closedRequest(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.length > SWITCHES.length) return null;
  const out = {};
  for (const key of keys) {
    const value = jsonValue(key, patch[key]);
    if (value === undefined) return null;
    out[key] = value;
  }
  return out;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const MODES = ['search', 'harvest', 'care', 'calibration', 'saving', 'unknown'];

/**
 * The skill's answer in its closed shape: {policy, mode}, every value of the policy checked; null for anything else (a
 * doubtful reading is not a reading). The path of the file is left out: the app and a screen have no use for it.
 */
export function closedPolicy(answer) {
  if (!isObject(answer) || answer.ok !== true || !isObject(answer.policy) || !MODES.includes(answer.mode)) return null;
  const p = answer.policy;
  const section = (name) => (isObject(p[name]) ? p[name] : null);
  const logo = section('logo');
  const pipeline = section('geocode_pipeline');
  const missing = section('geocode_missing');
  const recheck = section('recheck_weekly');
  if (!logo || !pipeline || !missing || !recheck) return null;
  const policy = {
    economy: p.economy,
    logo: { enabled: logo.enabled, min_score: logo.min_score },
    geocode_pipeline: { enabled: pipeline.enabled },
    geocode_missing: { enabled: missing.enabled, min_score: missing.min_score, non_remote_only: missing.non_remote_only },
    recheck_weekly: { enabled: recheck.enabled, min_score: recheck.min_score, older_than_days: recheck.older_than_days },
  };
  for (const [key] of SWITCHES) {
    const [name, field] = key.includes('.') ? key.split('.') : [key, null];
    const value = field ? policy[name][field] : policy[name];
    if (jsonValue(key, value) === undefined) return null;
  }
  return { policy, mode: answer.mode };
}

/** The last JSON line a skill printed, or null. */
export function lastJson(stdout) {
  const line = String(stdout ?? '').trim().split('\n').pop();
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

const onOff = (value) => (value ? say('enrichment.on') : say('enrichment.off'));
const threshold = (value) => (value === null ? '' : `, ${say('enrichment.min_score', { n: value })}`);

/** What a person reads: the working mode, then one line per enrichment. */
export function describe({ policy, mode }) {
  const rows = [
    [say('enrichment.economy'), onOff(policy.economy)],
    [say('enrichment.logo'), onOff(policy.logo.enabled) + threshold(policy.logo.min_score)],
    [say('enrichment.geocode_pipeline'),
      onOff(policy.geocode_pipeline.enabled) + (policy.geocode_missing.non_remote_only ? `, ${say('enrichment.non_remote_only')}` : '')],
    [say('enrichment.geocode_missing'), onOff(policy.geocode_missing.enabled) + threshold(policy.geocode_missing.min_score)],
    [say('enrichment.recheck_weekly'),
      `${onOff(policy.recheck_weekly.enabled)}, ${say('enrichment.min_score', { n: policy.recheck_weekly.min_score })}, `
      + say('enrichment.older_than', { days: policy.recheck_weekly.older_than_days })],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = [say('enrichment.title', { mode }), ...rows.map(([label, text]) => `  ${label.padEnd(width)}  ${text}`)];
  if (mode === 'saving') lines.push('', say('enrichment.mode_saving'));
  else if (mode === 'unknown') lines.push('', say('enrichment.mode_unknown'));
  else if (policy.economy) lines.push('', say('enrichment.economy_on'));
  lines.push('', say('enrichment.thresholds'), say('enrichment.set_hint'));
  return lines.join('\n');
}

/** The sentence of a refusal, in the person's language. */
export function refusalText(code, key = '') {
  switch (code) {
    case 'key_unknown': return say('enrichment.key_unknown', { key, keys: SWITCH_KEYS.join(', ') });
    case 'value_invalid': return say('enrichment.value_invalid', { key, expected: expectedText(key) });
    case 'write_failed': return say('enrichment.write_failed');
    default: return say('enrichment.unavailable');
  }
}

function expectedText(key) {
  switch (KIND.get(key)) {
    case 'bool': return say('enrichment.expect_bool');
    case 'score_or_null': return say('enrichment.expect_score_or_none');
    case 'days': return say('enrichment.expect_days');
    default: return say('enrichment.expect_score');
  }
}
