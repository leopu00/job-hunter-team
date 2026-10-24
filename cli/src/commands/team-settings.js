// jht team-settings get | apply — working hours and the model and effort of each role, for
// the desktop app (T-gap voce 2). The app does not write the box's config itself: it asks this
// command, run in the team's container, and shows what it read back.
//
// The same rules and the same write as the site (lib/team-settings.js: validSettings and
// applySettings) and as `jht wh` (writePrivateJson on jht.config.json), so a value that one of
// them would refuse is refused here, whole: nothing is half applied. A config that cannot be
// read, or holds a value out of the lists, is an error, never a default made up.
//
// Output is ONE JSON line: {"ok":true, ...} or {"ok":false,"code":<closed code>}.
// Exit 0 done, 1 refused, 2 the request itself is not valid.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { writePrivateJson } from '../lib/secure-config-io.js';
import {
  EFFORTS, MIN_WINDOW_HOURS, MODEL_CLASSES, ROLES, WEEKDAYS,
  applySettings, validRoleModels, validSettings, validWorkingHours,
} from '../lib/team-settings.js';

const CONFIG_FILE = join(JHT_HOME, 'jht.config.json');
const REQUEST_MAX_BYTES = 65536;

export const LISTS = Object.freeze({
  roles: ROLES, models: MODEL_CLASSES, efforts: EFFORTS, weekdays: WEEKDAYS, min_window_hours: MIN_WINDOW_HOURS,
});

const refuse = (code, exit = 1) => ({ exit, out: { ok: false, code } });

/** The settings as the config holds them, every value checked; a closed refusal otherwise. */
export function readSettings(path = CONFIG_FILE) {
  if (!existsSync(path)) return { error: refuse('config_missing') };
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { error: refuse('config_unreadable') };
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return { error: refuse('config_unreadable') };
  const team = config.team && typeof config.team === 'object' && !Array.isArray(config.team) ? config.team : {};
  const workingHours = team.working_hours ?? null;
  const roleModels = team.role_models ?? {};
  if (!validWorkingHours(workingHours) || !validRoleModels(roleModels)) return { error: refuse('config_invalid') };
  return { config, settings: { working_hours: workingHours, role_models: roleModels } };
}

export function getResult(path = CONFIG_FILE) {
  const read = readSettings(path);
  if (read.error) return read.error;
  return { exit: 0, out: { ok: true, ...read.settings, lists: LISTS } };
}

/** `raw` is the one JSON line of stdin: {"settings": {...}}. */
export function applyResult(raw, path = CONFIG_FILE) {
  let request;
  try {
    if (Buffer.byteLength(raw) > REQUEST_MAX_BYTES) return refuse('request_invalid', 2);
    request = JSON.parse(raw);
  } catch {
    return refuse('request_invalid', 2);
  }
  if (request === null || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).length !== 1 || !('settings' in request)) {
    return refuse('request_invalid', 2);
  }
  if (!validSettings(request.settings)) return refuse('value_invalid');
  const read = readSettings(path);
  if (read.error) return read.error;
  try {
    writePrivateJson(path, applySettings(read.config, request.settings));
  } catch {
    return refuse('write_failed');
  }
  // What the box holds now, read again: that is what the app shows, not what it sent.
  return getResult(path);
}

function print({ exit, out }) {
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exitCode = exit;
}

export function registerTeamSettingsCommand(program) {
  const cmd = program
    .command('team-settings')
    .description('Working hours and the model and effort of each role, as JSON (for the desktop app)');
  cmd.command('get').description('Print the settings and the lists of allowed values').action(() => print(getResult()));
  cmd.command('apply')
    .description('Apply {"settings": {...}} read from stdin, whole or not at all, then print what the box holds')
    .action(() => {
      let raw = '';
      try {
        raw = readFileSync(0, 'utf-8');
      } catch {
        return print(refuse('request_invalid', 2));
      }
      print(applyResult(raw.trim()));
    });
}
