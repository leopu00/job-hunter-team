/**
 * The CAPITANO's tools to start and stop the team (SICUREZZA §9), through the
 * hub's launcher. They ask; the launcher decides, and says why when it
 * refuses. No container, socket or `run.sh` is ever in the CAPITANO's reach.
 */

import { z } from "zod";

import type { ToolHandler } from "../tools/registry.ts";
import type { HubClient } from "./client.ts";
import { HUB_PATHS } from "./protocol.ts";

export const SPAWN_TOOL_NAMES = ["spawn_agent", "stop_agent", "list_agents"] as const;

/** The launcher's limits, as `/v1/spawn/limits` answers them. */
export interface SpawnLimits {
  models: string[];
  roles: Record<string, { cap_usd: number; instances: number }>;
  max_active: number;
  max_spawns: number;
  task_chars: number;
}

/**
 * The launcher's rules, in the words of the tool that will be judged by them.
 *
 * Measured, not supposed (VPS over five live rounds, 23-24/09): the CAPITANO
 * asked for `sonnet` in EVERY round and the allowlist refused it, then missed
 * the cap window, then found it — 5 rounds lost to the model, 4 to the cap, 2
 * to instances or spawns. Nine of those eleven were avoidable: they paid a
 * request to be told a rule. And the cost is not only money: in the fifth
 * round, with a 0.12 USD cap, the CAPITANO never reached a delegation at all.
 *
 * So the constraint goes BEFORE the attempt. The refusals were already clear —
 * they stay as they are; what was missing is that a model cannot read a rule it
 * is never shown. The values come from `Launcher.limits()`, which reads the
 * very fields `#start` refuses on, so the sentence below cannot drift from the
 * check: there is one list, not two.
 */
function limitsSentence(limits: SpawnLimits | undefined): string {
  if (!limits) {
    // Never invented: an unread limit is said to be unread.
    return (
      "The launcher's limits could not be read just now, so ask for what the task needs and read the refusal: " +
      "it names the rule and the allowed values. `list_agents` shows what is left."
    );
  }
  const roles = Object.entries(limits.roles)
    .map(([role, r]) => `${role} cap_usd in (0, ${r.cap_usd}], up to ${r.instances} at once`)
    .join("; ");
  return (
    `The launcher's own limits, as it will check them — first attempt inside these and nothing is wasted. ` +
    `Models allowed: ${limits.models.join(", ")} (any other is refused). Roles: ${roles || "none configured"}. ` +
    `At most ${limits.max_active} children running at once, ${limits.max_spawns} spawns in the session, ` +
    `and a task of at most ${limits.task_chars} characters. A cap above its window is refused, not lowered for you.`
  );
}

const spawnSchema = z
  .object({
    role: z.string().max(32).describe("the role to start: scout, analista, scorer"),
    instance: z.number().int().min(1).max(9).optional().describe("which instance, e.g. 2 for scout-2; default: the first free one"),
    cap_usd: z.number().positive().describe("the most this child may spend, in USD"),
    model: z.string().max(64).describe("the model it runs on"),
    task: z.string().min(1).describe("its first order, as you would send it"),
  })
  .strict();

export function createSpawnTools(hub: HubClient, limits?: SpawnLimits | undefined): ToolHandler[] {
  const call = async (path: string, body: unknown) => {
    try {
      const answer = await hub.post<Record<string, unknown>>(path, body);
      const refused = answer["ok"] === false;
      return { ok: !refused, content: JSON.stringify(answer, null, 2) };
    } catch (error) {
      return { ok: false, content: `Error: ${error instanceof Error ? error.message : String(error)}` };
    }
  };
  return [
    {
      spec: {
        name: "spawn_agent",
        description:
          "Start an agent of the team with a first order. The launcher checks the role, the model, the cap, the session's " +
          "money and how many are running; a refusal says why. Returns the spawn_id to stop it by. " +
          limitsSentence(limits),
        schema: spawnSchema,
      },
      // It starts a process that spends money: never a silent call.
      classify: (args) => {
        const a = args as z.infer<typeof spawnSchema>;
        return { risk: "execute", paths: [], summary: `${a.role}${a.instance ? `-${a.instance}` : ""} · ${a.model} · ${a.cap_usd} USD` };
      },
      execute: (args) => call(HUB_PATHS.spawn, args),
    },
    {
      spec: {
        name: "stop_agent",
        description: "Stop an agent you started, by its spawn_id.",
        schema: z.object({ spawn_id: z.string().regex(/^[0-9a-f]{16}$/) }).strict(),
      },
      classify: (args) => ({ risk: "execute", paths: [], summary: (args as { spawn_id: string }).spawn_id }),
      execute: (args) => call(HUB_PATHS.spawnStop, args),
    },
    {
      spec: {
        name: "list_agents",
        description: "The agents you started in this session, their state and spend, and the money left.",
        schema: z.object({}).strict(),
      },
      classify: () => ({ risk: "none", paths: [], summary: "" }),
      execute: () => call(HUB_PATHS.spawnList, {}),
    },
  ];
}
