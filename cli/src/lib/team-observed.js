/**
 * Is the team running, as the box sees it: the observed `team_state.is_running`.
 *
 * Nobody wrote it any more. The only writer was the old reconciler
 * (`applyAction`, on a start or a stop it ran itself), which the default
 * daemon retired: a team started from the TUI, the desktop or `jht team
 * start` left the cloud saying `false`. On a VPS (leone, 27/09) that stale
 * `false` made the polling daemon back off as for a stopped team — 60 s per
 * fast round, one heartbeat every ~12 minutes, a box the dashboard showed as
 * offline while it worked. The heartbeat now carries what is true.
 *
 * The rule is `jht team status`'s: at least one tmux session of a team agent
 * (commands/team/list.js). tmux is read with the three outcomes of
 * `readTmuxSessions`: sessions, «no server» (nothing runs), or «cannot
 * tell» — and a «cannot tell» writes nothing, instead of a `false` that would
 * be a guess.
 */

import { AGENTS, isAgentSession } from '../commands/team/agents.js';
import { readTmuxSessions } from './api/tmux-read.js';

/**
 * @param {object} [options]
 * @param {typeof readTmuxSessions} [options.read] injectable for tests
 * @returns {boolean | null} null = unknown, leave `is_running` as it is
 */
export function observeTeamRunning({ read = readTmuxSessions } = {}) {
  let result;
  try {
    result = read();
  } catch {
    return null;
  }
  if (result?.tmux === 'no-server') return false;
  if (result?.tmux !== 'ok' || !Array.isArray(result.sessions)) return null;
  return result.sessions.some((name) => AGENTS.some((agent) => isAgentSession(name, agent)));
}
