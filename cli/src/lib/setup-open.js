/**
 * The flag of a `jht setup` that is open: `$JHT_HOME/.setup-open.flag`. While it stands the watchdogs and the start of the
 * container do not start the team: the service is being chosen and its sign-in may not be done, and a team started on the
 * configuration of before spends on a service the person is leaving (a trial of the ChatGPT subscription on Pi: the watchdog
 * started the team on the old Claude key and spent 0.89 $). The setup takes it off when it ends, is cancelled, or starts the
 * team itself. A flag left by a killed setup stays good for SETUP_OPEN_MAX_MS only (the shell gates read the same two hours).
 */
import { statSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const SETUP_OPEN_MAX_MS = 2 * 60 * 60 * 1000;

export function setupOpenPath(home) {
  return join(home, '.setup-open.flag');
}

/** True while a setup that began less than two hours ago has not ended. Never throws. */
export function setupOpen(home, now = Date.now()) {
  try {
    const st = statSync(setupOpenPath(home));
    return st.isFile() && now - st.mtimeMs < SETUP_OPEN_MAX_MS;
  } catch {
    return false;
  }
}

/** Marks the setup as open. A home that cannot be written to leaves things as they were: no flag, the setup goes on. */
export function openSetup(home) {
  try {
    writeFileSync(setupOpenPath(home), `${new Date().toISOString()}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function closeSetup(home) {
  try { rmSync(setupOpenPath(home), { force: true }); } catch { /* nothing to take off */ }
}
