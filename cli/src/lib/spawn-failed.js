/**
 * The agents that cannot start: the watchdog of the Dottore and the Mantenitore (.launcher/doctor-watchdog.sh) writes in
 * $JHT_HOME/logs/spawn-failed.json, per role, when the last start failed, its exit code and the line of the error, and takes
 * the role out when a start goes well. Without it a role that never started was only retried, every five minutes, in a log
 * nobody reads (giro Windows 16/11: Dottore and Mantenitore never started, 26 failures in an hour), and `jht team status`
 * counted its empty session as running. `jht team status` and `jht doctor` say it now. The file is in a folder the agents
 * write in: it is read as data, every value cut short and cleaned of control characters.
 */
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { later } from './texts.js';
import { whenOf } from './budget-pause.js';

const ROLES = { dottore: 'DOTTORE', mantenitore: 'MANTENITORE' };
const clean = (value, max) => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, max);

/** @returns {{ role: string, name: string, at: string|null, why: string }[]} */
export function spawnFailures({ home = JHT_HOME, now = new Date() } = {}) {
  let data;
  try { data = JSON.parse(readFileSync(join(home, 'logs', 'spawn-failed.json'), 'utf8')); }
  catch { return []; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const out = [];
  for (const [role, name] of Object.entries(ROLES)) {
    const entry = data[role];
    if (!entry || typeof entry !== 'object') continue;
    out.push({ role, name, at: whenOf(clean(entry.at, 40), now), why: clean(entry.why, 240) });
  }
  return out;
}

/** One text per role that cannot start, to be written later in the person's language. */
export function spawnFailureTexts(options = {}) {
  return spawnFailures(options).map((f) => {
    const vars = { name: f.name, at: f.at ?? '?', why: f.why };
    // each key written whole: the test of the catalog finds the texts a screen asks for by their name
    return f.why ? later('agents.cannot_start', vars) : later('agents.cannot_start_no_reason', vars);
  });
}

/**
 * A new start of the container (`jht up`, an update) gets a new verdict: the failures written in the life before (another
 * image, another configuration) are not said as today's. Giro Mac build11: after the update `jht team status` still said the
 * Dottore of build10 «cannot start (last attempt 17/11 21:20)», and the Dottore of build11 was working. pid1 calls it once,
 * before the first start of the watchdog (not when it starts it again after a crash): a role that still cannot start is
 * written again at its next attempt.
 * @returns {boolean} whether there was a file to forget
 */
export function forgetSpawnFailures({ home = JHT_HOME } = {}) {
  try { unlinkSync(join(home, 'logs', 'spawn-failed.json')); return true; } catch { return false; }
}
