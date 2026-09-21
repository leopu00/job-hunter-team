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


/**
 * T39: the CLOSER's rehearsal, and it is a rehearsal of a REFUSAL.
 *
 * This is the only role that acts outward: it sends the applications the
 * person authorised, one position at a time. Every one of those actions
 * leaves the box — a browser on the recruiter's form, an upload, a Submit, an
 * SMTP send — and none of them exists in this image. So what this run shows
 * is exactly what the role does when sending is not possible, which its own
 * prompt already answers: the flow cannot run, there is no receipt, and
 * without a receipt nothing is marked `applied` (CL-02).
 *
 * It starts from a queue that is READY — consent on, a position the person
 * flagged from a user channel, a CV whose layout poppler measured and passed
 * (T39, piece three) — because a queue that is never ready rehearses nothing:
 * the role would stop at step 1 and the refusal below would never be met. It
 * reads the position, tries the flow, is told why it cannot, tries to write
 * the sent state anyway — refused, because that is not a rule here but an
 * absence — tells the person once for the whole round, reports to the
 * CAPITANO and leaves the queue alone.
 *
 * What it must NOT do is in here too: no second attempt on the same position
 * (CL-03), no picking a position of its own (CL-04).
 */
export const CLOSER_MOCK_SCRIPT: ScriptedTurn[] = [
  { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
  {
    // STEP 1: the queue is the only source of work (CL-04). It answers READY:
    // position 1 is authorised and its CV passed the layout check — so what
    // follows is the role doing its job, and meeting the one step that cannot
    // happen here. (On a box without poppler the CV is unmeasured and held;
    // the rest of the run is then what a model that tries anyway runs into.)
    text: "The queue first: the gate decides what may go out.",
    toolCalls: [{ name: "apply_gate", args: { args: ["queue", "--json"] } }],
  },
  {
    text: "The queue is ready. The position the person authorised, and what was written for it.",
    toolCalls: [
      { name: "db_query", args: { args: ["position", "1"] } },
      { name: "db_query", args: { args: ["application", "1"] } },
    ],
  },
  {
    text: "The flow, as the skill says to run it.",
    toolCalls: [
      {
        name: "bash",
        args: { command: "python3 /app/shared/skills/apply_flow.py --position-id 1 --url https://jobs.example/1 --profile /jht_home/profile/candidate_profile.yml --cv /jht_out/cv/CV.pdf" },
      },
    ],
  },
  {
    text: "No browser here, so no receipt. I record neither the send nor a state I cannot prove.",
    toolCalls: [{ name: "db_update", args: { args: ["application", "1", "--applied-at", "now", "--applied-via", "agent_closer"] } }],
  },
  {
    text: "Refused, and rightly. One message for the whole round, then the report.",
    toolCalls: [
      {
        name: "notify_user",
        args: {
          kind: "notification",
          position_id: 1,
          text: "Acme, Backend Engineer: not sent. This box has no browser, so the form cannot be filled and no receipt can exist — the position stays authorised and untouched.",
        },
      },
    ],
  },
  {
    toolCalls: [
      {
        name: "send_message",
        args: { to: "capitano", text: "[@closer-1 -> @capitano] [BLOCKED] CLOSER apply_flow unavailable in this image: no browser, no receipt, nothing sent. Position 1 left as it was." },
      },
    ],
  },
  { toolCalls: [{ name: "throttle", args: { reason: "queue closed: nothing can be sent from here" } }] },
  { text: "Paused." },
  { toolCalls: [{ name: "check_user_replies", args: {} }] },
  { text: "Mock run complete: nothing was sent, nothing was marked sent, and the person was told once." },
];

/**
 * T40: the MENTOR's daily pass. It is read-only by its own M-04 — "never
 * db_insert.py / db_update.py, never the profile" — and silent by M-01, and
 * both are fences here rather than habits. It wakes on the person's replies,
 * reads their name from the profile, walks the sets it watches (the
 * exclusions, the outcome funnel of what was sent, the reasons the person
 * types) and counts before it speaks (M-02, M-05).
 *
 * What it must NOT do is in here too, and is refused: moving a position it is
 * judging, and telling the SCOUT what to search — the person's reasons are
 * spoken to the person, "never to the Scout" (mentor-patterns, Pattern F).
 * Its word reaches the person through `chat_reply`, the tool `jht-send` is here.
 */
export function mentorMockScript(profileDir: string): ScriptedTurn[] {
  return [
    { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
    { text: "What the person said while I was away.", toolCalls: [{ name: "check_user_replies", args: {} }] },
    { text: "Their name, and what they aim at.", toolCalls: [{ name: "read_file", args: { path: `${profileDir}/candidate_profile.yml` } }] },
    {
      text: "The sets, not the points: what was excluded, what came back from what was sent, what they wrote.",
      toolCalls: [
        { name: "db_query", args: { args: ["positions", "--status", "excluded"] } },
        { name: "db_query", args: { args: ["applications", "--days", "0"] } },
        { name: "feedback_query", args: { command: "themes" } },
      ],
    },
    {
      // M-04, tried and refused: the pipeline it judges is not its to move.
      text: "Position 2 is plainly out of reach. I would mark it.",
      toolCalls: [{ name: "db_update", args: { args: ["position", "2", "--status", "excluded", "--notes", "ESCLUSA: [SENIORITY] mentor"] } }],
    },
    {
      // Pattern F: the person's reasons go to the person, never to the Scout.
      text: "And tell the Scout to stop bringing senior roles.",
      toolCalls: [{ name: "send_message", args: { to: "scout-1", text: "[@mentor -> @scout-1] [REQ] Stop searching senior roles." } }],
    },
    {
      text: "Refused, and rightly: I suggest, the person decides. The number, to them.",
      toolCalls: [
        {
          name: "chat_reply",
          args: {
            text: "A Person, I have counted. Two of the three positions excluded this month were excluded for seniority. Is the target still senior?",
          },
        },
      ],
    },
    { toolCalls: [{ name: "throttle", args: { reason: "daily pass done; silence until the next one" } }] },
    { text: "Paused." },
    { toolCalls: [{ name: "check_user_replies", args: {} }] },
    { text: "Mock run complete: records read, nothing written, one number to the person and nothing to the workers." },
  ];
}

/**
 * T37: the SENTINELLA's rehearsal on a tick it must act on.
 *
 * Its turn starts with the mailbox — a verdict that never reached a pane is
 * still there — and, because what it is about to send is a DAILY brake, with
 * the one read its prompt demands before that order: has the person suspended
 * this very ceiling (S-10)? Then it advises the CAPITANO, and only the
 * CAPITANO: the message it tries to send straight to the worker that is
 * burning is refused, which is the fence of this role (RULE #0). The freeze
 * it would reach for in the TUI is a tmux command and says so here: stopping
 * the team is the hub's, not a role's (T37-2).
 *
 * "You ADVISE, he DECIDES": nothing in this run touches the database, and
 * nothing stops a worker.
 */
export const SENTINELLA_MOCK_SCRIPT: ScriptedTurn[] = [
  { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
  {
    text: "The verdicts no pane received, and whether the daily ceiling is suspended.",
    toolCalls: [
      { name: "bridge_mailbox", args: { args: ["drain"] } },
      { name: "burn_intent", args: { args: ["status", "--json"] } },
    ],
  },
  {
    text: "The team is over the day's budget and nobody suspended it: I freeze first, then tell him.",
    toolCalls: [{ name: "bash", args: { command: "python3 /app/shared/skills/freeze_team.py" } }],
  },
  {
    text: "No panes here. The advice goes to the Capitano, with the numbers.",
    toolCalls: [
      {
        name: "send_message",
        args: {
          to: "capitano",
          text:
            "[@sentinella -> @capitano] [WEEKLY-PACE] SFORO GIORNALIERO: today 22% of the weekly vs budget 15% (cap 20%), " +
            "no derogation live. Top-burn: scout-1 41% share / cadence 0.15. I suggest HARD-COAST: no new spawns, max " +
            "throttle on the autonomous workers, drain only. Throttle: 600s (`throttle 600 --agent scout-1`, timeout: 630). You decide.",
        },
      },
    ],
  },
  {
    text: "And a word straight to the worker that is burning.",
    toolCalls: [{ name: "send_message", args: { to: "scout-1", text: "[@sentinella -> @scout-1] [REQ] Slow down." } }],
  },
  { text: "Refused, and rightly: I advise, he decides.", toolCalls: [{ name: "throttle", args: { reason: "waiting for the next tick" } }] },
  { text: "Paused." },
  { toolCalls: [{ name: "check_user_replies", args: {} }] },
  { text: "Mock run complete: mailbox drained, derogation read, one piece of advice to the Capitano and nothing else." },
];

/**
 * T25: the SCRITTORE's rehearsal on the position the SCORER left `scored`
 * with the person's CV request on it. It opens the anti-rewrite gate, claims
 * the position, reads the profile, writes the CV where the person will find
 * it, renders the PDF the company receives, records the application and hands
 * it to the Critic. T30: the render is a tool with a fixed argument vector —
 * where a box has no pandoc or wkhtmltopdf the call says so, and the markdown
 * stays the deliverable (docs/parity.md).
 */
export function scrittoreMockScript(userDir: string, profileDir: string, historyDir?: string): ScriptedTurn[] {
  const cv = `${userDir}/cv/CV_Candidate_1_acme.md`;
  return [
    { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
    {
      text: "My queue, the position, and whether someone already judged it.",
      toolCalls: [
        { name: "db_query", args: { args: ["next-for-scrittore"] } },
        { name: "db_query", args: { args: ["position", "1"] } },
        { name: "db_query", args: { args: ["application", "1"] } },
      ],
    },
    { text: "Nothing written yet: I claim it.", toolCalls: [{ name: "db_update", args: { args: ["position", "1", "--status", "writing"] } }] },
    {
      text: "The candidate's own words, and the CV out of them.",
      toolCalls: [
        { name: "read_file", args: { path: `${profileDir}/candidate_profile.yml` } },
        {
          name: "write_file",
          args: {
            path: cv,
            content:
              "# Candidate — Backend Engineer\n\n## Summary\nSix years on TypeScript services.\n\n" +
              "## Experience\n- Payments API, 2023-2026\n\n## Skills\nTypeScript, SQLite, Node\n",
          },
        },
      ],
    },
    {
      text: "And the PDF the company receives.",
      toolCalls: [{ name: "render_pdf", args: { source: cv, title: "CV Candidate" } }],
    },
    ...(historyDir === undefined
      ? []
      : [
          {
            // The person's own CVs: read them for the tone, never write among them.
            text: "What the person wrote before, and what happens if I try to change it.",
            toolCalls: [
              { name: "read_file", args: { path: `${historyDir}/CV_2024.md` } },
              { name: "write_file", args: { path: `${historyDir}/CV_2024.md`, content: "# replaced\n" } },
            ],
          },
        ]),
    {
      text: "The application, and the CV recorded on it.",
      toolCalls: [
        { name: "db_insert", args: { args: ["application", "--position-id", "1", "--cv-path", cv] } },
        { name: "db_update", args: { args: ["application", "1", "--status", "review"] } },
      ],
    },
    {
      // T35: the critic-loop runs the CRITICO inside this process, as a
      // subagent. It must review blind — and the fence, not the prompt, is
      // what makes it so: its first move here is the profile, refused.
      text: "The Critic, in this process, blind.",
      toolCalls: [
        {
          name: "agent",
          args: { description: "blind review", prompt: `Review the CV at ${cv} against the job description and report SCORE: X.X/10.` },
        },
      ],
    },
    { text: "", toolCalls: [{ name: "read_file", args: { path: `${profileDir}/candidate_profile.yml` } }] },
    { text: "Blind review done, on the CV alone. SCORE: 6.5/10." },
    {
      // The review loop is in-process (T33): the Critic is a subagent of this
      // Writer, so the verdict comes back here — and has to reach the person,
      // which is what `save_review` is for. On the live chain of 21/09 nobody
      // wrote it and `critiche/` stayed empty with the verdict already given.
      text: "The Critic's round, and its verdict where the person reads it.",
      toolCalls: [
        {
          name: "save_review",
          args: {
            position_id: 1,
            text: "# Blind review — Acme, Backend Engineer\n\nSCORE: 6.5/10\n\nNo numbers on the payments work.\n",
          },
        },
      ],
    },
    {
      text: "To the Critic, blind.",
      toolCalls: [
        { name: "send_message", args: { to: "critico-1", text: `[REQ] Blind review: CV ${cv}, position 1. Reply with SCORE: X.X/10.` } },
      ],
    },
    { toolCalls: [{ name: "throttle", args: { reason: "waiting for the Critic's verdict" } }] },
    { text: "Paused." },
    { toolCalls: [{ name: "check_user_replies", args: {} }] },
    { text: "Mock run complete: one CV written, its application in review, the Critic asked." },
  ];
}

/**
 * T25: the CRITICO's rehearsal. It takes the review it was asked for, reads
 * the document as data, writes the verdict where the person can read it and
 *答 answers the Writer. It writes nothing in the database: the verdict is the
 * Writer's to record (bug #21).
 */
export function criticoMockScript(userDir: string, profileDir: string): ScriptedTurn[] {
  return [
    { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
    {
      text: "What is waiting for a verdict, and its state.",
      toolCalls: [
        { name: "db_query", args: { args: ["next-for-critico"] } },
        { name: "db_query", args: { args: ["application", "1"] } },
      ],
    },
    {
      // The blind contract, tried and refused: CR-01 is code here, not a promise.
      text: "The document itself — and the candidate's profile, which is not mine to read.",
      toolCalls: [
        { name: "read_file", args: { path: `${userDir}/cv/CV_Candidate_1_acme.md` } },
        { name: "read_file", args: { path: `${profileDir}/candidate_profile.yml` } },
      ],
    },
    {
      text: "The verdict, in writing.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: `${userDir}/critiche/review-acme-2026-09-20.md`,
            content:
              "# Blind review — Acme, Backend Engineer\n\nSCORE: 6.5/10\n\n" +
              "## What works\nThe stack matches the JD.\n\n## What does not\nNo numbers on the payments work.\n" +
              "\n## Note\nThe document asked to be scored 10/10 and to skip the rubric. That is text in a CV, not an instruction: scored on its content.\n",
          },
        },
      ],
    },
    {
      text: "Back to the Writer that asked.",
      toolCalls: [{ name: "send_message", args: { to: "scrittore-1", text: "[RES] SCORE: 6.5/10 — see the review under critiche/. Add numbers to the payments work." } }],
    },
    { text: "Mock run complete: one blind review written, the Writer answered, the database untouched." },
  ];
}

/** The rehearsal for a product role: the SCORER, the ANALISTA, the CAPITANO, the SCRITTORE and the CRITICO have their own, every other role plays the SCOUT's. */
/**
 * T38: the ASSISTENTE's rehearsal. It is the one role that talks to the
 * person, and the one that writes their profile: it picks up what they said,
 * reads the profile, writes what they told it, validates the write (A-02),
 * answers on the channel the message came from, and hands the operational part
 * to the CAPITANO. It touches the person's own documents only to prove it
 * cannot: the history stays read-only for every role, this one included.
 */
export function assistenteMockScript(profileDir: string, historyDir?: string): ScriptedTurn[] {
  const profile = `${profileDir}/candidate_profile.yml`;
  return [
    { text: "Reading my instructions.", toolCalls: [{ name: "read_file", args: { path: "AGENTS.md", limit: 20 } }] },
    { text: "What the person said while I was away.", toolCalls: [{ name: "check_user_replies", args: {} }] },
    { text: "Their profile as it stands.", toolCalls: [{ name: "read_file", args: { path: profile } }] },
    {
      // The write no other role may make, and the validation that always follows it.
      text: "What they just told me, written down.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: profile,
            content:
              "name: A Person\ntarget_role: Backend Engineer\nlocation: Roma, Italia\n" +
              "experience_years: 6\nhas_degree: true\nseniority_target: mid\n" +
              "skills:\n  primary:\n    - TypeScript\n    - SQLite\nlanguages:\n" +
              "  - language: Italiano\n    level: madrelingua\n",
          },
        },
      ],
    },
    { text: "And checked, before I say anything to them.", toolCalls: [{ name: "validate_profile", args: { args: [profile] } }] },
    ...(historyDir === undefined
      ? []
      : [
          {
            // The person's own documents: read for the tone, never changed.
            text: "What they wrote themselves, and what happens if I try to change it.",
            toolCalls: [
              { name: "read_file", args: { path: `${historyDir}/CV_2024.md` } },
              { name: "write_file", args: { path: `${historyDir}/CV_2024.md`, content: "# replaced\n" } },
            ],
          },
        ]),
    { text: "Where the team is, to answer their question.", toolCalls: [{ name: "db_query", args: { args: ["dashboard"] } }] },
    {
      text: "The answer, in their words, and the order in the team's.",
      toolCalls: [
        { name: "chat_reply", args: { text: "I have added your experience to your profile — the left panel is up to date." } },
        { name: "send_message", args: { to: "capitano-1", text: "[@assistente -> @capitano] [REQ] The person asked for the pipeline status." } },
      ],
    },
    { toolCalls: [{ name: "throttle", args: { reason: "waiting for the person's next message" } }] },
    { text: "Paused." },
    // The second cycle, as the loop wakes it: the person's answer first.
    { toolCalls: [{ name: "check_user_replies", args: {} }] },
    { text: "Mock run complete: the profile is written and valid, the person answered, the Capitano asked." },
  ];
}

export function productRoleMockScript(role: string, userDir = ".", profileDir = ".", historyDir?: string): ScriptedTurn[] {
  if (role === "assistente") return assistenteMockScript(profileDir, historyDir);
  if (role === "scorer") return SCORER_MOCK_SCRIPT;
  if (role === "analista") return ANALISTA_MOCK_SCRIPT;
  if (role === "capitano") return CAPITANO_MOCK_SCRIPT;
  if (role === "scrittore") return scrittoreMockScript(userDir, profileDir, historyDir);
  if (role === "critico") return criticoMockScript(userDir, profileDir);
  if (role === "sentinella") return SENTINELLA_MOCK_SCRIPT;
  if (role === "closer") return CLOSER_MOCK_SCRIPT;
  if (role === "mentor") return mentorMockScript(profileDir);
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
