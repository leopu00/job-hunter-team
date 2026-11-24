// Pause and resume of the cloud sync: edits of cloud.json that keep the pairing.
//
// `jht cloud disable` deletes the file and revokes the token on the server; a pause only turns `enabled` off and
// leaves everything else as it was (token, user_id, base_url, supabase_*, the cursors next to the file), so that
// `resume` is one step. The reader of the switch is shared/cloud/sync-switch.js; this file is the only writer
// of its fields:
//   enabled      false while paused
//   paused_at    ISO time of the pause (present only while paused)
//   paused_by    «cli» (jht cloud pause), «installer» (paired with the sync left off), «release-0.4.0» (the migration)
//   sync_choice  «user» (the person chose, by pause, resume, enable or login), «migrated» (the migration paused it);
//                absent = an installation that never went through the choice
import { existsSync, readFileSync } from 'node:fs';
import { hasToken } from '../../../shared/cloud/sync-switch.js';
import { writePrivateJson } from './secure-config-io.js';

export const MIGRATION_PAUSED_BY = 'release-0.4.0';
/** Said once, by whoever runs the migration. */
export const MIGRATION_NOTICE =
  'Cloud sync is now paused on this machine and the pairing is kept. The site and its web commands stay offline; '
  + 'the terminal, the app and Telegram are not affected. To turn it back on: jht cloud resume';

/** The file as it is: an object, or null when absent, unreadable or not an object. */
export function readCloudFile(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** @returns {{ok: boolean, changed?: boolean, reason?: string, config?: object}} */
export function pauseCloud(file, { by = 'cli', now = new Date() } = {}) {
  const config = readCloudFile(file);
  if (!config || !hasToken(config)) return { ok: false, reason: 'not-paired' };
  if (config.enabled !== true && typeof config.paused_at === 'string' && config.paused_at !== '') {
    return { ok: true, changed: false, config };
  }
  const next = { ...config, enabled: false, paused_at: now.toISOString(), paused_by: by, sync_choice: 'user' };
  writePrivateJson(file, next);
  return { ok: true, changed: true, config: next };
}

/** @returns {{ok: boolean, changed?: boolean, reason?: string, config?: object}} */
export function resumeCloud(file) {
  const config = readCloudFile(file);
  if (!config || !hasToken(config)) return { ok: false, reason: 'not-paired' };
  if (config.enabled === true && config.sync_choice === 'user') return { ok: true, changed: false, config };
  const { paused_at: _a, paused_by: _b, ...rest } = config;
  const next = { ...rest, enabled: true, sync_choice: 'user' };
  writePrivateJson(file, next);
  return { ok: true, changed: true, config: next };
}

/**
 * One-time migration: a pairing that was on before this version and never went through the choice is paused,
 * once. Without a file nothing is created. `resume` (and pause, enable, login) write sync_choice, so the
 * migration never comes back on its own.
 * @returns {{migrated: boolean}}
 */
export function migrateSyncChoice(file, { now = new Date() } = {}) {
  if (!existsSync(file)) return { migrated: false };
  const config = readCloudFile(file);
  if (!config || config.enabled !== true || (config.sync_choice !== undefined && config.sync_choice !== null)) {
    return { migrated: false };
  }
  writePrivateJson(file, {
    ...config, enabled: false, paused_at: now.toISOString(), paused_by: MIGRATION_PAUSED_BY, sync_choice: 'migrated',
  });
  return { migrated: true };
}
