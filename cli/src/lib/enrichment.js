/**
 * The switches of the Analisti's enrichments (enrichment-policy.json): what the team does on its own to complete a position,
 * the company logo, the office on the map, the recheck of the live positions.
 *
 * The rules live in shared/skills/enrichment_policy.py, the one writer of the file: `show` reads it, `apply` takes one JSON
 * object of switches and typed values on stdin and writes all of them or none. Here only what a person types (on, off, a
 * number, none) becomes a typed value, and the answer becomes lines in the person's language. `jht enrichment` and the
 * desktop (through `jht team-settings`) use these same lists.
 */
import { say, textLanguage } from './texts.js';

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
  ['web_search.analista.enabled', 'bool'],
  ['web_search.scout.enabled', 'bool'],
  ['web_search.mentor.enabled', 'bool'],
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

/** The value at a dotted key of the policy (`logo.enabled`, `web_search.scout.enabled`), or undefined. */
function valueAt(policy, key) {
  return key.split('.').reduce((node, name) => (isObject(node) ? node[name] : undefined), policy);
}

function setAt(policy, key, value) {
  const names = key.split('.');
  const last = names.pop();
  let node = policy;
  for (const name of names) node = node[name] ??= {};
  node[last] = value;
}

const isAmount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

/**
 * The costs of the switches (shared/skills/enrichment_costs.json, read by the skill and sent with `show`), in a closed shape:
 * {positions_per_day, switches: {key: {costly, usd_per_position, usd_per_search?}}}. Only on/off switches of the list; an entry
 * off its shape is left out, the rest kept. null when there is no usable table (an older team): then no switch warns.
 */
export function closedCosts(costs) {
  if (!isObject(costs) || !isObject(costs.switches)) return null;
  const perDay = costs.positions_per_day;
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > 10000) return null;
  const switches = {};
  for (const [key, kind] of SWITCHES) {
    const entry = costs.switches[key];
    if (kind !== 'bool' || !isObject(entry) || typeof entry.costly !== 'boolean') continue;
    const perPosition = entry.usd_per_position;
    if (perPosition !== null && !isAmount(perPosition)) continue;
    if (entry.usd_per_search !== undefined && !isAmount(entry.usd_per_search)) continue;
    switches[key] = { costly: entry.costly, usd_per_position: perPosition,
      ...(entry.usd_per_search === undefined ? {} : { usd_per_search: entry.usd_per_search }) };
  }
  return { positions_per_day: perDay, switches };
}

/**
 * The skill's answer in its closed shape: {policy, mode, costs?}, every value of the policy checked; null for anything else (a
 * doubtful reading is not a reading). The path of the file is left out: the app and a screen have no use for it. The costs are
 * optional: a team without them is read all the same, its switches just never warn.
 */
export function closedPolicy(answer) {
  if (!isObject(answer) || answer.ok !== true || !isObject(answer.policy) || !MODES.includes(answer.mode)) return null;
  const policy = {};
  for (const [key] of SWITCHES) {
    const value = valueAt(answer.policy, key);
    if (jsonValue(key, value) === undefined) return null;
    setAt(policy, key, value);
  }
  const costs = closedCosts(answer.costs);
  return costs ? { policy, mode: answer.mode, costs } : { policy, mode: answer.mode };
}

/**
 * What turning `key` from `before` to `after` costs more, when it does: {perPosition, perDay, positionsPerDay} or {perSearch}
 * or {unmeasured: true}; null when the change costs nothing more (or the table does not name the switch).
 */
export function extraCost(key, before, after, costs) {
  const entry = costs?.switches?.[key];
  if (!entry || before === after || after !== entry.costly) return null;
  if (typeof entry.usd_per_position === 'number') {
    return { perPosition: entry.usd_per_position, perDay: entry.usd_per_position * costs.positions_per_day, positionsPerDay: costs.positions_per_day };
  }
  if (typeof entry.usd_per_search === 'number') return { perSearch: entry.usd_per_search };
  return { unmeasured: true };
}

/** The amounts in dollars in the person's language: 0,008 · 0,40. */
export function money(value, language) {
  const digits = value !== 0 && value < 0.01 ? 3 : 2;
  return new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(value);
}

/** A day's cost, which is an estimate: from 10 $ up in whole dollars («about 13 $ a day»), below that as money(). */
export function dayMoney(value, language) {
  if (value >= 10) return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value);
  return money(value, language);
}

/** The sentence that says what `key` costs more, in the person's language; '' when it costs nothing more. */
export function costText(key, cost, language) {
  if (!cost) return '';
  const name = labelOf(key, language);
  if (cost.unmeasured) return say('enrichment.cost_unmeasured', { name }, language);
  if (cost.perSearch !== undefined) return say('enrichment.cost_per_search', { name, usd: money(cost.perSearch, language) }, language);
  return say('enrichment.cost_per_position',
    { name, usd: money(cost.perPosition, language), day: dayMoney(cost.perDay, language), n: cost.positionsPerDay }, language);
}

/** The name of a switch in a warning (literal keys: the catalog test reads them). */
function labelOf(key, language) {
  switch (key) {
    case 'economy': return say('enrichment.economy_off', {}, language);
    case 'logo.enabled': return say('enrichment.logo', {}, language);
    case 'geocode_pipeline.enabled': return say('enrichment.geocode_pipeline', {}, language);
    case 'geocode_missing.enabled': return say('enrichment.geocode_missing', {}, language);
    case 'geocode_missing.non_remote_only': return say('enrichment.non_remote_only', {}, language);
    case 'recheck_weekly.enabled': return say('enrichment.recheck_weekly', {}, language);
    case 'web_search.analista.enabled': return say('enrichment.web_search_analista', {}, language);
    case 'web_search.scout.enabled': return say('enrichment.web_search_scout', {}, language);
    case 'web_search.mentor.enabled': return say('enrichment.web_search_mentor', {}, language);
    default: return key;
  }
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

/** The estimated cost of the dearer side of a switch, for the column of `show`: '' with no figure in the table. */
export function costCell(key, costs, language = textLanguage()) {
  const entry = costs?.switches?.[key];
  if (!entry) return '';
  const state = key === 'geocode_missing.non_remote_only' ? say('enrichment.remote_too', {}, language)
    : say(entry.costly ? 'enrichment.on' : 'enrichment.off', {}, language);
  if (typeof entry.usd_per_position === 'number') {
    return say('enrichment.cost_cell_position', { state, usd: money(entry.usd_per_position, language) }, language);
  }
  if (typeof entry.usd_per_search === 'number') {
    return say('enrichment.cost_cell_search', { state, usd: money(entry.usd_per_search, language) }, language);
  }
  return say('enrichment.cost_cell_unmeasured', { state }, language);
}

/** What a person reads: the working mode, then one line per enrichment, with the estimated cost of its dearer side when the
 * team sends the table of the costs (the same one the confirmation reads). */
export function describe({ policy, mode, costs }) {
  const rows = [
    [say('enrichment.economy'), onOff(policy.economy), ['economy']],
    [say('enrichment.logo'), onOff(policy.logo.enabled) + threshold(policy.logo.min_score), ['logo.enabled']],
    [say('enrichment.geocode_pipeline'),
      onOff(policy.geocode_pipeline.enabled) + (policy.geocode_missing.non_remote_only ? `, ${say('enrichment.non_remote_only')}` : ''),
      ['geocode_pipeline.enabled', 'geocode_missing.non_remote_only']],
    [say('enrichment.geocode_missing'), onOff(policy.geocode_missing.enabled) + threshold(policy.geocode_missing.min_score),
      ['geocode_missing.enabled']],
    [say('enrichment.recheck_weekly'),
      `${onOff(policy.recheck_weekly.enabled)}, ${say('enrichment.min_score', { n: policy.recheck_weekly.min_score })}, `
      + say('enrichment.older_than', { days: policy.recheck_weekly.older_than_days }), ['recheck_weekly.enabled']],
    [say('enrichment.web_search_analista'), onOff(policy.web_search.analista.enabled), ['web_search.analista.enabled']],
    [say('enrichment.web_search_scout'), onOff(policy.web_search.scout.enabled), ['web_search.scout.enabled']],
    [say('enrichment.web_search_mentor'), onOff(policy.web_search.mentor.enabled), ['web_search.mentor.enabled']],
  ].map(([label, text, keys]) => [label, text, keys.map((key) => costCell(key, costs)).filter(Boolean).join('; ')]);
  const width = Math.max(...rows.map(([label]) => label.length));
  const priced = rows.some(([, , cost]) => cost);
  const stateWidth = Math.max(...rows.map(([, text]) => text.length));
  const line = ([label, text, cost]) => (priced && cost
    ? `  ${label.padEnd(width)}  ${text.padEnd(stateWidth)}  ${cost}` : `  ${label.padEnd(width)}  ${text}`);
  const lines = [say('enrichment.title', { mode }), ...rows.map(line)];
  if (mode === 'saving') lines.push('', say('enrichment.mode_saving'));
  else if (mode === 'unknown') lines.push('', say('enrichment.mode_unknown'));
  else if (policy.economy) lines.push('', say('enrichment.economy_on'));
  if (priced) lines.push('', say('enrichment.cost_note'));
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
