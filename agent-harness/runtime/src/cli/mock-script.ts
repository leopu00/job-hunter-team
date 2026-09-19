/**
 * The scripted run the mock provider plays when no script is given.
 *
 * It exists so `npm run role` works for any role with no key, no network and
 * no spend, and still exercises the whole loop: a plan, a free read of the
 * agent's own home, a shell command, a subagent, and a final answer. The mock
 * ignores the prompt: it is a rehearsal of the control flow, not an agent.
 */

import { readFile } from "node:fs/promises";

import { HarnessError } from "../core/errors.ts";
import type { ScriptedTurn } from "../core/provider/mock.ts";

export const DEFAULT_MOCK_SCRIPT: ScriptedTurn[] = [
  {
    text: "Planning the run.",
    toolCalls: [
      {
        name: "todo_write",
        args: {
          todos: [
            { content: "Read my identity file", status: "in_progress" },
            { content: "Look around the home folder", status: "pending" },
            { content: "Report", status: "pending" },
          ],
        },
      },
      { name: "read_file", args: { path: "AGENTS.md", limit: 20 } },
    ],
  },
  {
    toolCalls: [
      { name: "glob", args: { pattern: "*" } },
      { name: "bash", args: { command: "pwd && ls -a" } },
    ],
  },
  {
    toolCalls: [{ name: "agent", args: { description: "count the files", prompt: "Count the files in the working folder and report the number." } }],
  },
  // The subagent's own rounds: one tool call, then its report.
  { toolCalls: [{ name: "glob", args: { pattern: "**/*" } }] },
  { text: "The working folder holds the identity file and the home marker." },
  {
    toolCalls: [
      {
        name: "todo_write",
        args: {
          todos: [
            { content: "Read my identity file", status: "completed" },
            { content: "Look around the home folder", status: "completed" },
            { content: "Report", status: "completed" },
          ],
        },
      },
    ],
  },
  { text: "Mock run complete: the loop, the tools, a subagent and the trace all worked." },
];

/** A script from a JSON file: an array of `ScriptedTurn`. */
export async function readMockScript(path: string): Promise<ScriptedTurn[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new HarnessError("config_invalid", `Could not read the mock script at ${path}: ${(error as Error).message}`);
  }
  if (!Array.isArray(raw)) {
    throw new HarnessError("config_invalid", `The mock script at ${path} must be a JSON array of turns.`);
  }
  return raw as ScriptedTurn[];
}
