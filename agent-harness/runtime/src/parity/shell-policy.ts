/**
 * Which roles have a shell, and which do not (T42).
 *
 * `bash` is the most useful tool an agent can have and the widest: it reaches
 * every file the process's uid can touch, and no policy of this runtime
 * stands between it and them. Measured on 23/09 across the twelve ported
 * roles — `rm -rf` on seven targets, 84 attempts, 84 successes, the person's
 * profile and the team's database included; in the same run `write_file` on
 * the profile was denied and `bash rm` on that same file was not. On a real
 * box the uid and the mounts close most of it; on a development box nothing
 * does. Either way a tool nobody's instructions use is a power for free.
 *
 * So the question was asked of the prompts, not of the code: for each role,
 * its prompt plus the SKILL.md files its `skills.list` really loads, only the
 * blocks declared as shell, minus every command that is already a native tool
 * or a refusal pointing at one. What is left is the shell a role would lose.
 *
 * For these seven the answer was nothing, or nothing of its own:
 *
 * | role       | what was left                                              |
 * |------------|------------------------------------------------------------|
 * | analista   | nothing                                                     |
 * | scorer     | nothing                                                     |
 * | critico    | nothing                                                     |
 * | closer     | nothing                                                     |
 * | mentor     | `spawn-doctor.sh` + `sleep` — spawning is the hub's, and the CAPITANO's |
 * | sentinella | the same two lines                                          |
 * | scout      | five `echo` of its own diagnostics                          |
 *
 * They lose the tool itself, not a guard in front of it: an absence is the
 * shape this harnessuses where a power must not exist (the CLOSER cannot
 * mark an application sent). And because a role that loses a tool it used can
 * stop without saying so — which this team has already paid for — the
 * system prompt of these roles says it in one line, and `tests/no-shell.test.ts`
 * runs each of them against a turn that reaches for the shell: what comes back
 * must name the tools it does have, so the model reports instead of looking
 * for another way in.
 *
 * The other five keep it: the CAPITANO by the MASTER's decision, and the
 * ASSISTENTE, the SCRITTORE, the DOTTORE and the MANTENITORE until their
 * residue is measured the same way (`agents-hq/piani/MISURA-BASH-PER-RUOLO.md`).
 */

import { roleOf } from "../db/role-policy.ts";
import type { ToolHandler } from "../tools/registry.ts";
import { pythonRefusal, REPLACED_REASONS, replacedCommand } from "./jht-tools.ts";

/** The roles that have no shell here. */
export const ROLES_WITHOUT_SHELL: readonly string[] = ["analista", "scorer", "critico", "closer", "mentor", "sentinella", "scout"];

export function hasShell(agent: string): boolean {
  return !ROLES_WITHOUT_SHELL.includes(roleOf(agent));
}

/**
 * The line added to these roles' parity notes. It is the anti-silence half of
 * the change: the model has to know that a missing shell is the harness's
 * doing and that the answer is to report, not to find a way around.
 */
/**
 * Where each role's shell commands went. The general half holds for all seven
 * — every command their instructions name is a tool here — and the rest
 * answers the lines the measurement actually found in their skills.
 */
const WHERE_IT_WENT: Readonly<Record<string, string>> = {
  mentor:
    "The only shell line your skills carry is the one that spawns a DOTTORE, and starting a role here is the hub's: " +
    "only the CAPITANO reaches it (`spawn_agent`). Ask the CAPITANO instead.",
  sentinella:
    "The only shell line your skills carry is the one that spawns a DOTTORE, and starting a role here is the hub's: " +
    "only the CAPITANO reaches it (`spawn_agent`). Advise the CAPITANO — that is your whole part.",
  scout:
    "The shell lines in your skills are `echo` of your own diagnostics: here that belongs in what you report, " +
    "not in a command. Say it in your message, or leave it in the row you write.",
};

const GENERAL =
  "Every command your instructions name is a native tool here, with the script's own arguments — and what has no tool " +
  "is not available at all. If you needed something you cannot find among your tools, say WHICH in your report: " +
  "never look for another way to reach it.";

/**
 * What the shell answers a role that does not have one.
 *
 * The specific reason comes first, when there is one. A CLOSER reaching for
 * `apply_flow.py` must still hear that there is no browser, so no receipt, so
 * CL-02 holds — that sentence is the whole teaching of that boundary, and
 * losing it to a generic "no shell here" would be a step backwards. Only when
 * the line carries no command this harness has an answer for does the refusal
 * fall back to naming where the role's own shell commands went.
 */
export function shellRefusal(agent: string, command: string, env: NodeJS.ProcessEnv = process.env): string {
  const role = roleOf(agent);
  const first = command.trim().split(/\s+/u)[0] ?? "";
  // The tail is deliberately NOT the role's own `WHERE_IT_WENT`: that sentence
  // answers "where did MY shell commands go", and here the model asked about a
  // different command and has just been told. A refusal that answers the
  // question nobody asked is worse than a blunt one (MASTER, review of T42).
  const noShell = `And there is no shell for the ${role.toUpperCase()} here in any case: every command your instructions name is a tool, or it is not available at all.`;
  const python = pythonRefusal(command, {}, env);
  if (python !== null) return `${python} ${noShell}`.replace(/ {2,}/gu, " ");
  const replaced = replacedCommand(command);
  if (replaced !== null) return `Error: \`${replaced}\` ${REPLACED_REASONS[replaced] ?? "is not available here."} Nothing was run. ${noShell}`.replace(/ {2,}/gu, " ");
  const where = WHERE_IT_WENT[role] ?? "";
  return (
    `Error: there is no shell for the ${role.toUpperCase()} in this harness${first ? ` — \`${first}\` was not run` : ""}. ` +
    `${where} ${GENERAL}`
  ).replace(/ {2,}/gu, " ");
}

export const NO_SHELL_NOTE =
  "You have no shell here: there is no `bash` tool for your role. Every command your instructions name is a tool " +
  "in this harness, or it is not available at all — and what your skills run with a shell, they run for things this " +
  "runtime does not have. If you need something you cannot find among your tools, say so in your report: never look " +
  "for another way to reach it.";

/**
 * The shell tool of a role that has none: it advertises what it is, and every
 * call comes back with the reason. The description matters as much as the
 * refusal — a model that reads it does not spend a turn finding out.
 */
export function noShellTool(bash: ToolHandler, agent: string): ToolHandler {
  return {
    spec: {
      ...bash.spec,
      description: `Not available to the ${roleOf(agent).toUpperCase()} in this harness. ${NO_SHELL_NOTE}`,
    },
    classify: () => ({ risk: "none", paths: [], summary: "no shell for this role" }),
    execute: (args) => Promise.resolve({ ok: false, content: shellRefusal(agent, (args as { command?: string }).command ?? "") }),
  };
}
