/**
 * `jht up` starts the container, not the team: a team that the person stopped (`jht team stop --all`, Stop in the app) stays
 * stopped behind `.team-halted.flag` and the container does not start it. The flag that a first installation makes by itself
 * («initial-setup», the team waits for the setup) is not the person's stop and has its own way out: `jht setup`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** True when `$JHT_HOME/.team-halted.flag` is there and is the person's stop. Never throws. */
export function teamStoppedByPerson(home) {
  try {
    return !/^initial-setup\b/.test(readFileSync(join(home, '.team-halted.flag'), 'utf8'));
  } catch {
    return false;
  }
}
