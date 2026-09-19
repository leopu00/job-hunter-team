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

/** The score of the SCORER's mock cycle, as scorer.md writes it. */
const MOCK_SCORE = [
  "score",
  "--position-id", "1",
  "--total", "72",
  "--stack-match", "30",
  "--remote-fit", "20",
  "--salary-fit", "10",
  "--experience-fit", "7",
  "--strategic-fit", "5",
  "--breakdown", "STACK: TypeScript, as asked\nREMOTE: hybrid, Milan",
  "--notes", "Mock score.",
  "--scored-by", "scorer-1",
];

/**
 * The SCORER's rehearsal (T15): its queue, the feedback themes, the claim of
 * the position, the score and `--status scored`, the report and a pause. It scores position #1, so the database
 * needs one in `checked`, as the ANALISTA leaves it; on an empty one the queue
 * is empty and the insert fails on the foreign key, which is what the script
 * would do too.
 */
export const SCORER_MOCK_SCRIPT: ScriptedTurn[] = [
  { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
  {
    text: "My queue, and what the person liked and disliked so far.",
    toolCalls: [
      { name: "db_query", args: { args: ["next-for-scorer"] } },
      { name: "feedback_query", args: { command: "themes" } },
    ],
  },
  {
    text: "Claim it, then read it.",
    toolCalls: [
      { name: "db_update", args: { args: ["position", "1", "--last-checked", "now"] } },
      { name: "db_query", args: { args: ["position", "1"] } },
    ],
  },
  {
    text: "One position, scored and saved right away.",
    toolCalls: [
      { name: "db_insert", args: { args: MOCK_SCORE } },
      { name: "db_update", args: { args: ["position", "1", "--status", "scored"] } },
    ],
  },
  { toolCalls: [{ name: "send_message", args: { to: "capitano", text: "[RES] Mock cycle: 1 position scored, 72/100." } }] },
  { toolCalls: [{ name: "throttle", args: { reason: "queue done" } }] },
  { text: "Paused." },
  { toolCalls: [{ name: "check_user_replies", args: {} }] },
  { text: "Mock run complete: the queue, one score and a pause on the native tools." },
];

/** What the ANALISTA writes on the position it checks: RULE-04's five fields and the team note, RULE-13's metadata, RULE-16's summary. */
const MOCK_ANALYSIS = [
  "position", "1", "--status", "checked",
  "--notes",
  "EXPERIENCE_REQUIRED: 3\\nEXPERIENCE_TYPE: preferred\\nDEGREE: not required\\nLANGUAGE_REQUIRED: English\\nSENIORITY_JD: mid\\n\\nA product team that ships weekly: worth a look.",
  "--jd-summary", "**Backend Developer** at Acme, hybrid in **Milan**.\\n- TypeScript services\\n- Weekly releases",
  "--loc-city", "Milan", "--loc-country", "Italy", "--loc-country-code", "IT", "--work-mode", "hybrid",
  "--salary-estimated-min", "40000", "--salary-estimated-max", "55000", "--salary-estimated-currency", "EUR", "--salary-estimated-source", "default",
  "--role-family", "Backend Engineering", "--expires-at", "2099-12-31",
];

/**
 * The ANALISTA's rehearsal (T14): its queue, the position, the deadline and
 * the rough salary, the company registry, then the analysis written and the
 * position moved `new` → `checked`, one highlight, a pause. It works on
 * position #1, so the database needs one in `new`, as the SCOUT leaves it.
 * No network tool: the rehearsal runs offline.
 */
export const ANALISTA_MOCK_SCRIPT: ScriptedTurn[] = [
  { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
  {
    text: "My queue, and the first position in it.",
    toolCalls: [
      { name: "db_query", args: { args: ["next-for-analista"] } },
      { name: "db_query", args: { args: ["position", "1"] } },
    ],
  },
  {
    text: "Deadline, rough salary, and whether the company is known.",
    toolCalls: [
      { name: "deadline_extract", args: { args: ["--jd", "Applications close on 2099-12-31."] } },
      { name: "salary_estimate", args: { args: ["--position-id", "1", "--stack", "typescript", "--seniority", "mid", "--country", "IT", "--mode", "hybrid"] } },
      { name: "db_query", args: { args: ["company", "Acme"] } },
      { name: "db_query", args: { args: ["active-categories"] } },
    ],
  },
  {
    text: "First time I meet Acme: into the registry. Then the analysis.",
    toolCalls: [
      { name: "db_insert", args: { args: ["company", "--name", "Acme", "--hq-country", "IT", "--sector", "software", "--verdict", "GO", "--analyzed-by", "analista-1"] } },
      { name: "db_update", args: { args: MOCK_ANALYSIS } },
      { name: "db_insert", args: { args: ["highlight", "--position-id", "1", "--type", "pro", "--text", "Weekly releases and a hybrid week"] } },
    ],
  },
  { toolCalls: [{ name: "throttle", args: { reason: "one position per turn" } }] },
  { text: "Paused." },
  { toolCalls: [{ name: "check_user_replies", args: {} }] },
  { text: "Mock run complete: one position analysed and moved to checked on the native tools." },
];

/**
 * T21: the CAPITANO's rehearsal, without spawning. It wakes as capitano.md
 * C-21 and C-06 say (yesterday's handoff, the person's standing orders, the
 * time as the person reads it), reads the pipeline, drains the user-ticket
 * queue (C-15), merges two near-duplicate categories (C-17), tries to start
 * a Scorer the TUI way and is told the harness's way, writes a note in its
 * diary and pauses. The database needs an open ticket and the two
 * categories; nothing reaches the network.
 */
export const CAPITANO_MOCK_SCRIPT: ScriptedTurn[] = [
  { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
  {
    text: "Waking up: yesterday's notes, the person's orders, the time.",
    toolCalls: [
      { name: "captain_diary", args: { args: ["handoff"] } },
      { name: "team_directives", args: { args: ["active"] } },
      { name: "format_time", args: { args: ["--now"] } },
    ],
  },
  {
    text: "The pipeline, and the user tickets before any autonomous work.",
    toolCalls: [
      { name: "db_query", args: { args: ["dashboard"] } },
      { name: "db_query", args: { args: ["next-for-scorer"] } },
      { name: "ticket", args: { args: ["list-open"] } },
    ],
  },
  {
    text: "The oldest ticket to the Analista, two duplicate categories into one.",
    toolCalls: [
      { name: "ticket", args: { args: ["assign", "1", "analista-1"] } },
      { name: "role_registry", args: { args: ["merge", "--into", "Backend Engineering", "--sources", "Backend", "Backend Eng"] } },
    ],
  },
  {
    text: "A Scorer for the checked queue, the way I know.",
    toolCalls: [{ name: "bash", args: { command: "/app/.launcher/start-agent.sh scorer 1" } }],
  },
  {
    text: "Not here without the hub. A note for tomorrow.",
    toolCalls: [{ name: "captain_diary", args: { args: ["add", "Ticket #1 to analista-1; Backend families merged."] } }],
  },
  { toolCalls: [{ name: "throttle", args: { reason: "queue drained" } }] },
  { text: "Paused." },
  { toolCalls: [{ name: "check_user_replies", args: {} }] },
  { text: "Mock run complete: the CAPITANO woke, read the pipeline, routed a ticket and merged two categories on the native tools." },
];

/** The rehearsal for a product role: the SCORER, the ANALISTA and the CAPITANO have their own, every other role plays the SCOUT's. */
export function productRoleMockScript(role: string): ScriptedTurn[] {
  if (role === "scorer") return SCORER_MOCK_SCRIPT;
  if (role === "analista") return ANALISTA_MOCK_SCRIPT;
  if (role === "capitano") return CAPITANO_MOCK_SCRIPT;
  return PRODUCT_ROLE_MOCK_SCRIPT;
}

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
