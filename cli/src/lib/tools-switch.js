/**
 * The switch of the tools under way (JHT-T346): the host writes $JHT_HOME/state/tools-switch.json = {"schema":1,"at":"<ISO UTC>"}
 * just before it stops the core team and starts it again on the full image (scripts/jht-tools.sh, jht-tools.ps1). For a couple of
 * minutes the container is gone and comes back: the chat says it on a line of its own and keeps the line being typed, and
 * `jht team status` says the team is moving onto the full tools instead of «no agent».
 *
 * A notice only, in a folder the container writes too: a time that is not one, in the future, or older than SWITCH_WINDOW_S is no switch.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';

export const SWITCH_WINDOW_S = 10 * 60;
const CLOCK_SLACK_S = 120;

/** @returns {{ at: number }|null} the switch, its start in epoch seconds, while it is recent enough to still be under way */
export function toolsSwitch({ home = JHT_HOME, now = Date.now() / 1000 } = {}) {
  try {
    const path = join(home, 'state', 'tools-switch.json');
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 512) return null;
    const seen = JSON.parse(readFileSync(path, 'utf8'));
    if (seen?.schema !== 1 || typeof seen.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(seen.at)) return null;
    const at = Date.parse(seen.at) / 1000;
    if (!Number.isFinite(at) || at > now + CLOCK_SLACK_S || now - at > SWITCH_WINDOW_S) return null;
    return { at };
  } catch {
    return null;
  }
}
