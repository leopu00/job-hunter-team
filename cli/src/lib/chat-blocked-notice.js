/**
 * What `jht team chat` says when the agent the person talks to is blocked: the same reason and the same command as
 * `jht agents` (blockedLines), then where to look at the whole team. The chat used to answer such an agent with a
 * bare «no reply yet» / «no new messages», which reads as «wait» when nobody will ever answer.
 */
import { readObservation } from './agent-observation.js';
import { readActiveProvider } from './agent-observation-provider.js';
import { blockedLines } from './agent-observation-view.js';
import { say } from './texts.js';

/**
 * @param {string} session  tmux session of the agent (ASSISTENTE)
 * @returns {string[]}  the lines to print; [] when the agent is not blocked or the observation cannot be read
 */
// The chat names a session JHT-ASSISTENTE where the observer says ASSISTENTE: the same agent.
const sessionKey = (s) => String(s ?? '').toLowerCase().replace(/^jht-/, '');

export function blockedNoticeFor(session, { read = readObservation, provider = readActiveProvider(), width } = {}) {
  let snapshot;
  try { snapshot = read(); } catch { return []; }
  const row = Array.isArray(snapshot?.agents) ? snapshot.agents.find((r) => sessionKey(r?.session) === sessionKey(session)) : null;
  if (!row) return [];
  const lines = blockedLines({ agents: [row] }, provider, width);
  return lines.length ? [...lines, `  ${say('observation.chat_blocked_see')}`] : [];
}
