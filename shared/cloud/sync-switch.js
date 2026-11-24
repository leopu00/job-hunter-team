/**
 * Is the cloud sync on? ONE answer, for every reader of cloud.json.
 *
 * The rule used to be copied in every place that reads the file («enabled»
 * here, «enabled and a token» there), and a reader that forgot it kept
 * renewing a token on a box whose sync was off. This module is the rule; the
 * Python twin (shared/skills/sync_switch.py) must give the same answer on the
 * same cases: both read tests/fixtures/sync-switch-cases.json.
 *
 * Precedence, in this order:
 *   1. JHT_CLOUD_SYNC=0  → off, whatever the file says           («env-off»)
 *   2. JHT_CLOUD_SYNC=1  → on only if the file has a token       («env-on» / «env-no-token»)
 *      (it never turns the sync on without a pairing)
 *   3. anything else (unset, empty, «true»…) is ignored: the file decides.
 *      `enabled` must be the boolean true; a paused file keeps `paused_at`.
 *
 * ESM with no dependencies, like shared/release/version.js.
 */

export const SYNC_ENV = 'JHT_CLOUD_SYNC';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A pairing needs a token that is a non-blank string. */
export function hasToken(config) {
  return isObject(config) && typeof config.token === 'string' && config.token.trim() !== '';
}

/**
 * @param {unknown} config  cloud.json already parsed (null when absent or unreadable)
 * @param {object} [env]    defaults to process.env
 * @returns {{active: boolean, reason: string}}
 */
export function syncSwitch(config, env = process.env) {
  const raw = env?.[SYNC_ENV];
  const flag = typeof raw === 'string' ? raw.trim() : '';
  if (flag === '0') return { active: false, reason: 'env-off' };
  if (flag === '1') {
    return hasToken(config) ? { active: true, reason: 'env-on' } : { active: false, reason: 'env-no-token' };
  }
  if (!isObject(config)) return { active: false, reason: 'absent' };
  if (config.enabled === true) return { active: true, reason: 'file-enabled' };
  const pausedAt = config.paused_at;
  if (typeof pausedAt === 'string' && pausedAt !== '') return { active: false, reason: 'paused' };
  return { active: false, reason: 'disabled' };
}

/**
 * The config as the readers must see it: `enabled` is the answer of the
 * switch, so the readers that only look at `enabled` need no change. Never
 * save the result back to the file (the variable would be written into it).
 * Returns null when the file is not an object.
 */
export function effectiveConfig(config, env = process.env) {
  if (!isObject(config)) return null;
  return { ...config, enabled: syncSwitch(config, env).active };
}
