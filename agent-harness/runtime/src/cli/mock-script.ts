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

/**
 * The rehearsal for a product role (`--role` without `--prompt`): the same
 * shape as a TUI worker's cycle, on the native tools. Read the identity,
 * coordinate and claim as a Scout does at boot — on `scout_coord`,
 * `email_monitor` and `feedback_query`, never `python3 …/skills` — report to
 * the CAPITANO, pause; after the wake-up, check for the person's replies and
 * stop. The second turn plays only with `--turns 2` or more. Written for the
 * SCOUT: another role lacks the Scout's tools and gets an unknown-tool answer.
 */
/** The insert of the mock cycle, as the skill position-insert writes it. */
const MOCK_INSERT = [
  "position",
  "--title", "Mock Engineer",
  "--company", "Mock Ltd",
  "--url", "https://jobs.example/mock-1",
  "--location", "Milan, Italy",
  "--remote-type", "hybrid",
  "--source", "mock",
  "--found-by", "scout-1",
  "--jd-text", "A mock job description.",
  "--requirements", "TypeScript",
];

export const PRODUCT_ROLE_MOCK_SCRIPT: ScriptedTurn[] = [
  { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
  {
    text: "Boot: the split, then the mailbox.",
    toolCalls: [
      { name: "scout_coord", args: { command: "doctor" } },
      { name: "scout_coord", args: { command: "show" } },
      { name: "email_monitor", args: { command: "status" } },
    ],
  },
  {
    toolCalls: [
      { name: "scout_coord", args: { command: "assign", scout: "scout-1", cerchi: "1,2", fonti: "linkedin,greenhouse" } },
      { name: "scout_coord", args: { command: "claim", job_id: "https://jobs.example/mock-1", scout: "scout-1" } },
      { name: "feedback_query", args: { command: "check", legacy_id: "1" } },
    ],
  },
  // T6: one position found, checked, inserted; then the same one again, which the dedup catches.
  {
    text: "Gate 1, then Gate 5.",
    toolCalls: [
      { name: "scout_dedup", args: { args: ["check", "--url", "https://jobs.example/mock-1", "--company", "Mock Ltd", "--title", "Mock Engineer"] } },
      { name: "db_insert", args: { args: MOCK_INSERT } },
    ],
  },
  {
    text: "The same ad, found again on another board.",
    toolCalls: [
      { name: "scout_dedup", args: { args: ["check", "--url", "https://jobs.example/mock-1", "--company", "Mock Ltd", "--title", "Mock Engineer"] } },
      { name: "db_insert", args: { args: MOCK_INSERT } },
      { name: "db_query", args: { args: ["check-url", "https://jobs.example/mock-1"] } },
    ],
  },
  { toolCalls: [{ name: "send_message", args: { to: "capitano", text: "[RES] Mock cycle: batch done, 1 new position." } }] },
  { toolCalls: [{ name: "throttle", args: { reason: "batch done" } }] },
  { text: "Paused." },
  { toolCalls: [{ name: "check_user_replies", args: {} }] },
  { text: "Mock run complete: identity, a peer message, a pause and a wake-up on the native tools." },
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
