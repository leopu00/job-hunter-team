/**
 * provider-logout — the door of `jht agent-control provider status|logout`.
 *
 * The rules and the removal are shared/skills/provider_signin.py's (it holds the closed lists of credential
 * files and walks them folder by folder, never following a link). This only checks the shape — `status` or
 * `logout` and no more words — and runs the script with that one word as argv: no shell, no free text, no path,
 * no provider name from outside.
 *
 * `logout` STOPS THE TEAM FIRST, with the panel's own `stop-team` (the stop flag, then every agent's session):
 * a provider CLI that is still running writes its credential file again when it renews its token, and the
 * sign-in would come back. The credentials are touched only if the stop worked; if it did not, the panel's
 * closed answer (`team_stop_failed`, `agent_control_busy`) is what comes back and nothing is removed. The
 * Assistant's chat is the one session `stop-team` keeps: should it write its file back, the look after the
 * removal says so (`provider_logout_incomplete`) and never «disconnected».
 */
import { execScriptInContainer } from '../utils/container-proxy.js';
import { AGENT_CONTROL_SCRIPT, EXIT_INVALID, unansweredReply } from './agent-control-args.js';

export const PROVIDER_SIGNIN_SCRIPT = '/app/shared/skills/provider_signin.py';

export function runProvider(args, { write, exec = execScriptInContainer }) {
  const op = Array.isArray(args) && args.length === 1 ? args[0] : null;
  if (op !== 'status' && op !== 'logout') {
    write(`${JSON.stringify({ ok: false, error: 'agent_control_invalid' })}\n`);
    return EXIT_INVALID;
  }
  if (op === 'logout') {
    const stopped = exec(AGENT_CONTROL_SCRIPT, ['stop-team'], { interpreter: 'python3', timeoutMs: 180_000 });
    if (!stopped.ok || stopped.code < 0) {
      const { code, reply } = unansweredReply(stopped);
      write(`${JSON.stringify(reply)}\n`);
      return code;
    }
    if (stopped.code !== 0) {
      write(stopped.stdout);
      return stopped.code;
    }
  }
  const result = exec(PROVIDER_SIGNIN_SCRIPT, [op], { interpreter: 'python3', timeoutMs: 30_000 });
  if (!result.ok || result.code < 0) {
    const { code, reply } = unansweredReply(result);
    write(`${JSON.stringify(reply)}\n`);
    return code;
  }
  write(result.stdout);
  return result.code;
}
