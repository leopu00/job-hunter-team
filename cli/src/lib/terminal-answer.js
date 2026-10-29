// A line typed in `jht team chat` / `jht team send` may be the answer to a card the agent asked («Save this
// profile?», the plan): the card says «Reply with the option number», and in a terminal there is no button. The line is
// first offered to shared/skills/agent_chat.py `reply`, which records it the way the app's button does and wakes the
// agent; only a line that is not an answer goes on to the agent as text, as it always did.

import { execScriptInContainer } from '../utils/container-proxy.js';

export const AGENT_CHAT_SCRIPT = '/app/shared/skills/agent_chat.py';
// The agents a person talks to (agent_chat.AGENTS); another session name is just text.
const ANSWERING_AGENTS = new Set(['capitano', 'assistente', 'mentor']);

// The fixed reasons agent_questions gives for a reply that meant a question and is not one of its options.
const INVALID_REASONS = {
  number_out_of_range: 'that number is not one of the options',
  code_mismatch: 'that code is not the open question’s',
  reply_not_an_option: 'that is not one of the options',
};

function runInContainer(agent, message) {
  return execScriptInContainer(AGENT_CHAT_SCRIPT, ['reply', agent], {
    interpreter: 'python3', input: message, timeoutMs: 40_000,
  });
}

/**
 * {result: 'chat'} (send the line as text), {result: 'answered', label}, {result: 'closed'} or
 * {result: 'invalid', reason}. Anything that goes wrong in asking is `chat`: the line must never be lost.
 * `run(agent, message)` is the transport (the container); `usingContainer` says whether there is one.
 */
export function answerTyped(session, message, { usingContainer, run = runInContainer } = {}) {
  const agent = String(session || '').toLowerCase();
  if (!ANSWERING_AGENTS.has(agent) || !usingContainer || typeof message !== 'string' || !message.trim()) {
    return { result: 'chat' };
  }
  let reply;
  try {
    reply = run(agent, message);
  } catch {
    return { result: 'chat' };
  }
  if (!reply || reply.code !== 0) return { result: 'chat' };
  try {
    const found = JSON.parse(String(reply.stdout || '').trim().split('\n').pop());
    if (found && found.result === 'answered') return { result: 'answered', label: String(found.label || '') };
    if (found && found.result === 'closed') return { result: 'closed' };
    if (found && found.result === 'invalid') {
      return { result: 'invalid', reason: INVALID_REASONS[found.reason] || 'that is not one of the options', code: String(found.code || '') };
    }
  } catch {
    return { result: 'chat' };
  }
  return { result: 'chat' };
}

/** The line to print for a result that is not `chat`, and whether the line counts as a failure. */
export function describeAnswer(found) {
  if (found.result === 'answered') {
    return { text: found.label ? `Answer recorded: ${found.label}` : 'Answer recorded', failed: false };
  }
  if (found.result === 'closed') return { text: 'That question is already closed: nothing was sent.', failed: false };
  return { text: `Not sent — ${found.reason}. Answer with the number shown on the card.`, failed: true };
}
