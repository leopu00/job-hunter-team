/**
 * `ticket.py` as a native tool, the subcommands of the role that runs it.
 *
 * A worker (T14, analista.md RULE-15) reads a ticket the Capitano assigned
 * it, says it is still being worked on, answers it: `show`, `touch`,
 * `resolve`. The Capitano (T21, capitano.md C-15) drains the queue:
 * `list-open`, `count-open`, `assign`, `show`, `for-position`; the answer is
 * the worker's, not its. `open` is the Assistente's. The Python's SQL and
 * messages; the rest is refused with the reason.
 *
 * The script asks tmux which agents are alive. The harness has no tmux: the
 * liveness is unknown, which the script already reads as "nobody is declared
 * dead" — a stale ticket returns to the queue only for lack of progress.
 *
 * One difference, on purpose: the script lets any caller touch or resolve
 * any ticket, and a resolve overwrites the answer the user reads. Here a
 * worker touches and resolves only a ticket assigned to it, checked before
 * the call and again in the UPDATE's WHERE.
 */

import { parseArgv, pyRepr, type CommandSpec } from "../../db/argv.ts";
import type { Database } from "../../db/jobs-db.ts";
import { PY_SPACE_CLASS, pyFloat, pyStr, pyTruthy } from "../../db/py-format.ts";
import { roleOf } from "../../db/role-policy.ts";
import { refused, type ScriptResult } from "../../db/tools.ts";
import { agentAliases } from "../../core/agent-id.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { AGENT_NAME } from "../jht-tools.ts";
import { argvTool } from "./argv-tool.ts";

const SUBCOMMANDS = ["open", "list-open", "count-open", "assign", "touch", "resolve", "show", "for-position"];
const WORKER = ["show", "touch", "resolve"];
const CAPTAIN = ["list-open", "count-open", "assign", "show", "for-position"];

/** Hours without progress before an assigned ticket returns to the queue (`STALE_IDLE_HOURS`). */
const STALE_IDLE_HOURS = 6;

const SPECS: Record<string, CommandSpec> = {
  show: { prog: "ticket.py show", mainProg: "ticket.py", positionals: [{ name: "id", type: "int" }] },
  touch: { prog: "ticket.py touch", mainProg: "ticket.py", positionals: [{ name: "id", type: "int" }] },
  "list-open": { prog: "ticket.py list-open", mainProg: "ticket.py" },
  "count-open": { prog: "ticket.py count-open", mainProg: "ticket.py" },
  assign: { prog: "ticket.py assign", mainProg: "ticket.py", positionals: [{ name: "id", type: "int" }, { name: "agent" }] },
  "for-position": { prog: "ticket.py for-position", mainProg: "ticket.py", positionals: [{ name: "position_id", type: "int" }] },
  resolve: {
    prog: "ticket.py resolve",
    mainProg: "ticket.py",
    positionals: [{ name: "id", type: "int" }],
    options: [{ flag: "--response", required: true }],
  },
};

type Row = Record<string, unknown>;

// The script's timestamps, as it explains them: `created_at` and `scored_at` are UTC,
// `assigned_at`, `updated_at` (on an assigned ticket), `last_checked` and `written_at`
// local time, each brought to UTC before it meets `julianday('now')`.
const AGE_HOURS = "(julianday('now') - julianday(created_at)) * 24.0";
const ASSIGNED_HOURS = "(julianday('now') - julianday(assigned_at, 'utc')) * 24.0";
const LAST_PROGRESS = `(
    SELECT MAX(
        IFNULL(julianday(p.last_checked, 'utc'), 0),
        IFNULL((SELECT MAX(julianday(s.scored_at)) FROM scores s
                 WHERE s.position_id = position_tickets.position_id), 0),
        IFNULL((SELECT MAX(julianday(a.written_at, 'utc'))
                  FROM applications a
                 WHERE a.position_id = position_tickets.position_id), 0)
    )
    FROM positions p WHERE p.id = position_tickets.position_id
)`;
const IDLE_HOURS = `(julianday('now') - MAX(
    IFNULL(julianday(assigned_at, 'utc'), 0),
    IFNULL(julianday(updated_at, 'utc'), 0),
    IFNULL(${LAST_PROGRESS}, 0)
)) * 24.0`;

/** `_stale_hours`: `JHT_TICKET_IDLE_HOURS` read as `float()`, the default when unset or unreadable. */
function staleHours(env: string | undefined): number {
  return env ? (pyFloat(env) ?? STALE_IDLE_HOURS) : STALE_IDLE_HOURS;
}

/** `_age_text`: how long, as a person reads it. */
function ageText(value: unknown): string {
  if (value === null || value === undefined) return "?";
  const hours = Math.max(0, Number(value));
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}g ${Math.trunc(hours % 24)}h`;
  if (hours >= 1) return `${Math.trunc(hours)}h ${Math.trunc((hours % 1) * 60)}m`;
  return `${Math.trunc(hours * 60)}m`;
}

/** `_fmt`: the computed waiting and idle times only where the query selected them. */
function format(t: Row): string {
  let head = `#${pyStr(t["id"])} [pos ${pyStr(t["position_id"])}] ${pyStr(t["status"])} kind=${pyTruthy(t["kind"]) ? pyStr(t["kind"]) : "custom"}`;
  if (pyTruthy(t["assigned_agent"])) head += ` → ${pyStr(t["assigned_agent"])}`;
  const age = t["age_hours"];
  if (age !== null && age !== undefined) head += ` · waiting ${ageText(age)}`;
  const held = t["assigned_hours"];
  if (held !== null && held !== undefined) {
    head += ` (assigned ${ageText(held)} ago`;
    const idle = t["idle_hours"];
    head += idle !== null && idle !== undefined ? `, idle ${ageText(idle)})` : ")";
  }
  const lines = [head, `   request : ${pyStr(t["request_text"])}`];
  if (pyTruthy(t["response_text"])) lines.push(`   response: ${pyStr(t["response_text"])}`);
  return lines.join("\n");
}

/** `stale_assignments` with the liveness unknown: an assigned ticket idle past the threshold. */
function staleAssignments(db: Database, hours: number): Row[] {
  const rows = db
    .prepare(
      `SELECT *, ${ASSIGNED_HOURS} AS assigned_hours, ${IDLE_HOURS} AS idle_hours FROM position_tickets ` +
        "WHERE status = 'assigned' AND resolved_at IS NULL ORDER BY created_at ASC",
    )
    .all() as Row[];
  return rows.filter((r) => r["idle_hours"] !== null && Number(r["idle_hours"]) >= hours);
}

/** The Capitano's queue: `list-open` (with `reclaim_stale`), `count-open`, `assign`, `for-position`. */
function captainCommand(db: Database, sub: string, a: Record<string, unknown>, env: string | undefined): ScriptResult {
  const out: string[] = [];
  if (sub === "count-open") {
    const n = Number((db.prepare("SELECT COUNT(*) AS n FROM position_tickets WHERE status = 'open'").get() as { n: number }).n);
    return { stdout: `${n + staleAssignments(db, staleHours(env)).length}\n`, exitCode: 0 };
  }
  if (sub === "assign") {
    // Narrower than the script on purpose (SICUREZZA, T21-2b): the assignee is a name the
    // team's messages accept, not any text the model writes into a row the workers read.
    const agent = a["agent"] as string;
    if (!AGENT_NAME.safeParse(agent).success) {
      return { stdout: "", stderr: `Ticket #${a["id"] as number} not assigned: ${pyRepr(agent)} is not an agent name (such as analista-1 or SCORER-2).\n`, exitCode: 1 };
    }
    const r = db
      .prepare(
        "UPDATE position_tickets SET status = 'assigned', assigned_agent = ?, assigned_at = datetime('now','localtime'), " +
          "updated_at = datetime('now','localtime') WHERE id = ? AND status IN ('open','assigned')",
      )
      .run(a["agent"] as string, a["id"] as number);
    if (Number(r.changes) === 0) return { stdout: "", stderr: `Ticket #${a["id"] as number} not found or already resolved.\n`, exitCode: 1 };
    return { stdout: `Ticket #${a["id"] as number} assigned to ${a["agent"] as string}.\n`, exitCode: 0 };
  }
  if (sub === "for-position") {
    const rows = db.prepare("SELECT * FROM position_tickets WHERE position_id = ? ORDER BY created_at ASC").all(a["position_id"] as number) as Row[];
    if (!rows.length) return { stdout: `No tickets for position ${a["position_id"] as number}.\n`, exitCode: 0 };
    return { stdout: `${rows.map(format).join("\n")}\n`, exitCode: 0 };
  }
  // list-open: the tickets nobody works on any more go back to the queue first, and say so.
  const reclaimed: Row[] = [];
  for (const row of staleAssignments(db, staleHours(env))) {
    const r = db
      .prepare(
        "UPDATE position_tickets SET status = 'open', assigned_agent = NULL, assigned_at = NULL, updated_at = datetime('now','localtime') " +
          "WHERE id = ? AND status = 'assigned'",
      )
      .run(row["id"] as number);
    if (Number(r.changes)) reclaimed.push(row);
  }
  for (const row of reclaimed) {
    out.push(`↩ #${pyStr(row["id"])} back in the queue — was ${pyStr(row["assigned_agent"])}: no progress for ${ageText(row["idle_hours"])}`);
  }
  const open = db.prepare(`SELECT *, ${AGE_HOURS} AS age_hours FROM position_tickets WHERE status = 'open' ORDER BY created_at ASC`).all() as Row[];
  const assigned = db
    .prepare(
      `SELECT *, ${AGE_HOURS} AS age_hours, ${ASSIGNED_HOURS} AS assigned_hours, ${IDLE_HOURS} AS idle_hours ` +
        "FROM position_tickets WHERE status = 'assigned' ORDER BY created_at ASC",
    )
    .all() as Row[];
  if (!open.length && !assigned.length) {
    out.push("No open tickets.");
  } else {
    if (open.length) {
      out.push(`OPEN tickets (${open.length}) — assign them with: ticket.py assign <id> <agent>`, ...open.map(format));
    } else {
      out.push("OPEN tickets (0) — nothing to assign right now.");
    }
    if (assigned.length) out.push(`ASSIGNED (${assigned.length}) — already being worked on, do NOT reassign:`, ...assigned.map(format));
  }
  return { stdout: `${out.join("\n")}\n`, exitCode: 0 };
}

export function ticketCommand(db: () => Database, agent: string, argv: string[], env: string | undefined = process.env["JHT_TICKET_IDLE_HOURS"]): ScriptResult {
  const sub = argv[0];
  if (sub === undefined) return usageError("the following arguments are required: cmd");
  if (!SUBCOMMANDS.includes(sub)) {
    return usageError(`argument cmd: invalid choice: ${pyRepr(sub)} (choose from ${SUBCOMMANDS.map((c) => `'${c}'`).join(", ")})`);
  }
  const ours = roleOf(agent) === "capitano" ? CAPTAIN : WORKER;
  if (!ours.includes(sub)) return refused("ticket", sub, ours);
  const a = parseArgv(SPECS[sub]!, argv.slice(1));
  if (sub !== "show" && CAPTAIN.includes(sub)) return captainCommand(db(), sub, a, env);
  const id = a["id"] as number;
  const fail = (message: string): ScriptResult => ({ stdout: "", stderr: `${message}\n`, exitCode: 1 });

  if (sub === "show") {
    const t = db().prepare("SELECT * FROM position_tickets WHERE id = ?").get(id) as Row | undefined;
    if (!t) return fail(`Ticket #${id} not found.`);
    return { stdout: `${format(t)}\n`, exitCode: 0 };
  }

  let response = "";
  if (sub === "resolve") {
    response = (a["response"] as string).replace(new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu"), "");
    if (!response) return fail("Response cannot be empty.");
  }
  const [own, alias = own] = agentAliases(agent) as [string, string?];
  const holder = db().prepare("SELECT assigned_agent FROM position_tickets WHERE id = ?").get(id) as { assigned_agent: string | null } | undefined;
  if (holder && ![own, alias].includes((holder.assigned_agent ?? "").toLowerCase())) {
    return fail(
      `Ticket #${id} is assigned to ${holder.assigned_agent ?? "nobody"}, not to you: you touch and resolve only the tickets the Capitano assigned you.`,
    );
  }

  if (sub === "touch") {
    const r = db()
      .prepare("UPDATE position_tickets SET updated_at = datetime('now','localtime') WHERE id = ? AND status = 'assigned' AND lower(assigned_agent) IN (?, ?)")
      .run(id, own, alias);
    if (Number(r.changes) === 0) return fail(`Ticket #${id} not found or not assigned: only a ticket you are holding can be touched.`);
    return { stdout: `Ticket #${id} still in progress (idle clock reset).\n`, exitCode: 0 };
  }

  // A rescore is resolved only once a newer score exists: the check and the answer are one statement.
  const r = db()
    .prepare(
      "UPDATE position_tickets AS ticket SET status = 'resolved', response_text = ?, resolved_at = datetime('now','localtime'), updated_at = datetime('now','localtime') " +
        "WHERE ticket.id = ? AND lower(ticket.assigned_agent) IN (?, ?) AND (ticket.kind <> 'rescore' OR EXISTS (" +
        "  SELECT 1 FROM scores s WHERE s.position_id = ticket.position_id AND julianday(s.scored_at) > julianday(ticket.created_at)))",
    )
    .run(response, id, own, alias);
  if (Number(r.changes) === 0) {
    const t = db().prepare("SELECT kind FROM position_tickets WHERE id = ?").get(id) as { kind: string | null } | undefined;
    if (t && t.kind === "rescore") {
      return fail(
        `Ticket #${id} cannot be resolved: rescore effect not verified (scores.scored_at must be newer than the ticket request). Run db_insert.py score --action rescore first.`,
      );
    }
    return fail(`Ticket #${id} not found.`);
  }
  return { stdout: `Ticket #${id} resolved (response visible to the user).\n`, exitCode: 0 };
}

function usageError(message: string): ScriptResult {
  return { stdout: "", stderr: `usage: ticket.py [-h] ...\nticket.py: error: ${message}\n`, exitCode: 2 };
}

export function createTicketTool(options: { db: () => Database; agent: string }): ToolHandler {
  return argvTool({
    name: "ticket",
    script: "ticket.py",
    description:
      roleOf(options.agent) === "capitano"
        ? "The user-ticket queue: list-open (oldest first; stale assignments return to the queue), count-open, assign <id> <agent>, show <id>, for-position <position_id>."
        : "Read, keep alive and answer a user ticket the Capitano assigned you: show <id>, touch <id>, resolve <id> --response \"...\".",
    run: (args) => ticketCommand(options.db, options.agent, args),
  });
}
