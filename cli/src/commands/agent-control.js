// `jht agent-control` — the agents' control panel of the desktop app.
//
//   jht agent-control start|stop|restart <SESSION>
//   jht agent-control pause --for-hours <n> | --until <iso> | --wake-on-weekly
//   jht agent-control resume
//   jht agent-control list | screen <SESSION> | team
//
// One JSON line on stdout and a closed exit code, both from
// shared/skills/agent_control.py, which holds every rule (see its header).
// This command only checks the shape and passes it on as argv: no shell, no
// free text. A shape it does not know is refused here, before the container.

import { Command } from 'commander';
import { execScriptInContainer } from '../utils/container-proxy.js';
import {
  AGENT_CONTROL_SCRIPT, EXIT_INVALID, agentControlArgv, unansweredReply,
} from '../lib/agent-control-args.js';

// A start waits for start-agent.sh (its own lock waits up to 75 s, its
// timeout in the script is 120 s): the command waits a little longer.
const TIMEOUT_MS = 180_000;

export function runAgentControl(args, { exec = execScriptInContainer, write = (s) => process.stdout.write(s) } = {}) {
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
      .description("The desktop app's agent control panel (start, stop, restart, pause, resume)")
      .argument('[args...]')
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments()
      .action((args) => {
        process.exitCode = runAgentControl(args ?? []);
      }),
  );
}
