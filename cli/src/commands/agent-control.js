// `jht agent-control` — the agents' control panel of the desktop app.
//
//   jht agent-control start|stop|restart <SESSION>
//   jht agent-control pause --for-hours <n> | --until <iso> | --wake-on-weekly
//   jht agent-control resume | stop-team
//   jht agent-control list | screen <SESSION> | team | history
//   jht agent-control exclusions | exclusion-accept <CODE> | exclusion-withdraw <CODE>
//   jht agent-control answer <QUESTION_ID> <OPTION_ID>
//   jht agent-control settings get | apply | burst-start | burst-stop   (working hours and role models, and
//     «work flat out until HH:MM»; `apply` and `burst-start` read stdin)
//
// One JSON line on stdout and a closed exit code, both from
// shared/skills/agent_control.py, which holds every rule (see its header).
// This command only checks the shape and passes it on as argv: no shell, no
// free text. A shape it does not know is refused here, before the container.

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { execScriptInContainer } from '../utils/container-proxy.js';
import { applyResult, burstStartResult, burstStopResult, getResult, withBurst } from './team-settings.js';
import {
  AGENT_CONTROL_SCRIPT, EXIT_INVALID, agentControlArgv, unansweredReply,
} from '../lib/agent-control-args.js';

// A start waits for start-agent.sh (its own lock waits up to 75 s, its
// timeout in the script is 120 s): the command waits a little longer.
const TIMEOUT_MS = 180_000;

/**
 * The team's working hours and role models, by the same door the panel uses (the attested wrapper
 * runs this in the container and never starts anything). The rules and the write are
 * team-settings.js's; here only the shape of the call and the panel's reply: {"ok":false,"error":code}.
 */
export function runSettings(args, { write, readStdin = () => readFileSync(0, 'utf-8'), exec = execScriptInContainer }) {
  const op = args.length === 1 ? args[0] : null;
  if (!['get', 'apply', 'burst-start', 'burst-stop'].includes(op)) {
    write(`${JSON.stringify({ ok: false, error: 'agent_control_invalid' })}\n`);
    return EXIT_INVALID;
  }
  let result;
  if (op === 'get') {
    result = withBurst(getResult(), exec);
  } else if (op === 'burst-stop') {
    result = burstStopResult(exec);
  } else {
    let raw = '';
    try {
      raw = readStdin();
    } catch {
      raw = '';
    }
    result = op === 'apply' ? withBurst(applyResult(String(raw).trim()), exec) : burstStartResult(String(raw).trim(), exec);
  }
  const out = result.out.ok ? result.out : { ok: false, error: result.out.code };
  write(`${JSON.stringify(out)}\n`);
  return result.exit;
}

export function runAgentControl(args, { exec = execScriptInContainer, write = (s) => process.stdout.write(s), readStdin } = {}) {
  if (Array.isArray(args) && args[0] === 'settings') return runSettings(args.slice(1), { write, readStdin, exec });
  const argv = agentControlArgv(args);
  if (!argv) {
    write(`${JSON.stringify({ ok: false, error: 'agent_control_invalid' })}\n`);
    return EXIT_INVALID;
  }
  const result = exec(AGENT_CONTROL_SCRIPT, argv, { interpreter: 'python3', timeoutMs: TIMEOUT_MS });
  if (!result.ok || result.code < 0) {
    const { code, reply } = unansweredReply(result);
    write(`${JSON.stringify(reply)}\n`);
    return code;
  }
  write(result.stdout);
  return result.code;
}

export function registerAgentControlCommand(program) {
  program.addCommand(
    new Command('agent-control')
      .description("The desktop app's agent control panel (start, stop, restart, pause, resume, stop-team)")
      .argument('[args...]')
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments()
      .action((args) => {
        process.exitCode = runAgentControl(args ?? []);
      }),
  );
}
