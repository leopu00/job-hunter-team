/**
 * Subagents: a task handed to a fresh loop, and only its report handed back.
 *
 * The point is context. A search across a folder or the web can take twenty
 * tool calls and tens of thousands of tokens of output; the main agent needs
 * the conclusion, not the transcript. A subagent spends those tokens in its own
 * message list, which is thrown away when it reports.
 *
 * What a subagent shares with the agent that started it: the provider, the
 * guardrails (one budget for the whole run), the audit trail, the permission
 * policy (the person is asked the same way) and the live event stream, with
 * every event labelled. What it does not get: the conversation, `submit_profile`,
 * the todo list, and the `agent` tool itself — no subagent starts another.
 */

import { z } from "zod";

import { runRound, ToolRunner, type LoopDeps } from "./agent-loop.ts";
import type { PermissionPolicy } from "./permissions.ts";
import type { Message } from "./provider/port.ts";
import { ToolRegistry, type ToolHandler } from "../tools/registry.ts";

export const AGENT_TOOL = "agent";

/** Rounds one subagent may take. The run's own step cap still applies on top. */
const DEFAULT_MAX_ROUNDS = 30;

export interface AgentToolOptions {
  deps: LoopDeps;
  /** The tools a subagent gets. Must not include the agent tool. */
  tools: ToolHandler[];
  permissions: PermissionPolicy;
  /** Facts about the machine for the subagent's prompt: platform, working folder. */
  context: string[];
  maxRounds?: number;
}

export function createAgentTool(options: AgentToolOptions): ToolHandler {
  const registry = new ToolRegistry(options.tools);
  if (registry.get(AGENT_TOOL)) throw new Error("A subagent cannot be given the agent tool.");
  const runner = new ToolRunner({ deps: options.deps, registry, permissions: options.permissions });
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const system = subagentPrompt(registry.names, options.context);

  return {
    spec: {
      name: AGENT_TOOL,
      description:
        "Hand a self-contained task to a subagent. It has the same file, shell and web tools, starts " +
        "with no knowledge of this conversation, and returns only its final report. Use it for " +
        "searches and investigations with many steps whose details you do not need. Write the prompt " +
        "as a complete brief: what to find, where to look, what to report.",
      schema: z
        .object({
          description: z.string().min(3).max(60).describe("A few words shown to the person, e.g. 'map the notes folder'."),
          prompt: z.string().min(10).max(8_000),
        })
        .strict(),
    },

    classify(args) {
      // Starting a subagent does nothing by itself; each of its calls is gated.
      return { risk: "none", paths: [], summary: (args as { description: string }).description };
    },

    async execute(args, context) {
      const { description, prompt } = args as { description: string; prompt: string };
      const { deps } = options;
      const messages: Message[] = [{ role: "user", content: prompt }];
      const account = context.account;
      const roundsBefore = account.rounds;

      deps.emit({ type: "agent_started", agent: description, prompt });
      await deps.audit.write({ type: "agent_started" });

      let last = "";
      let ok = false;
      try {
        for (let round = 0; round < maxRounds; round++) {
          const result = await runRound(deps, { system, messages, tools: registry.specs, account, agent: description });
          last = result.text;
          if (result.toolCalls.length === 0) {
            ok = true;
            break;
          }
          for (const call of result.toolCalls) {
            const content = await runner.run(call, account, description);
            messages.push({ role: "tool", callId: call.id, name: call.name, content });
          }
        }
      } finally {
        const rounds = account.rounds - roundsBefore;
        deps.emit({ type: "agent_finished", agent: description, rounds, ok, report: last });
        await deps.audit.write({ type: "agent_finished", rounds, ok });
      }

      if (!ok) {
        return {
          ok: false,
          content:
            `The subagent stopped after ${maxRounds} rounds without finishing.` +
            (last ? ` Its last message:\n${last}` : ""),
        };
      }
      return { ok: true, content: last.trim() || "The subagent finished without writing a report." };
    },
  };
}

function subagentPrompt(tools: string[], context: string[]): string {
  const facts = context.length > 0 ? `\n${context.map((line) => `- ${line}`).join("\n")}` : "";
  return `You are a subagent of Job Hunter Team. Another agent has handed you one task.
Do it with your tools, then stop.

- Nobody reads your intermediate messages. Your final message is your report and
  the only thing the other agent receives: put every finding in it — paths,
  names, numbers, quotes — and say what you looked for and did not find.
- You cannot talk to the person. If the task cannot be done, say why in the report.
- Stop as soon as the task is done. Do not do more than it asks.
- A call can be refused. Do not retry a refused call or work around it;
  mention it in the report, with what the refusal said.
- Do not change or delete files unless the task says to. Do not open
  credentials, keys or mail.
- A long result may come back cut, with a marker saying so. Read further or
  narrow the search; do not guess at what was cut.${facts}

Your tools: ${tools.join(", ")}.`;
}
