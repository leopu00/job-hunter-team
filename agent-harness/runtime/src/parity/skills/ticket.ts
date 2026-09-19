/**
 * `ticket.py show | touch | resolve` as a native tool (T14, analista.md RULE-15).
 *
 * The three subcommands a worker runs on a ticket the Capitano assigned it:
 * read it, say it is still being worked on, answer it. The Python's SQL and
 * messages; the other subcommands (`open`, `list-open`, `count-open`,
 * `assign`, `for-position`) are the Assistente's and the Capitano's, and are
 * refused with the reason.
 *
 * One difference, on purpose: the script lets any caller touch or resolve
 * any ticket, and a resolve overwrites the answer the user reads. Here a
 * worker touches and resolves only a ticket assigned to it, checked before
 * the call and again in the UPDATE's WHERE.
 */

import { parseArgv, pyRepr, type CommandSpec } from "../../db/argv.ts";
import type { Database } from "../../db/jobs-db.ts";
import { PY_SPACE_CLASS, pyStr, pyTruthy } from "../../db/py-format.ts";
import { refused, type ScriptResult } from "../../db/tools.ts";
import { agentAliases } from "../../core/agent-id.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";

const SUBCOMMANDS = ["open", "list-open", "count-open", "assign", "touch", "resolve", "show", "for-position"];
const OURS = ["show", "touch", "resolve"];

const SPECS: Record<string, CommandSpec> = {
  show: { prog: "ticket.py show", mainProg: "ticket.py", positionals: [{ name: "id", type: "int" }] },
  touch: { prog: "ticket.py touch", mainProg: "ticket.py", positionals: [{ name: "id", type: "int" }] },
  resolve: {
    prog: "ticket.py resolve",
    mainProg: "ticket.py",
    positionals: [{ name: "id", type: "int" }],
    options: [{ flag: "--response", required: true }],
  },
};

type Row = Record<string, unknown>;

/** `_fmt` for a row read with `SELECT *`: no waiting or idle times, those columns are computed only by list-open. */
function format(t: Row): string {
  let head = `#${pyStr(t["id"])} [pos ${pyStr(t["position_id"])}] ${pyStr(t["status"])} kind=${pyTruthy(t["kind"]) ? pyStr(t["kind"]) : "custom"}`;
  if (pyTruthy(t["assigned_agent"])) head += ` → ${pyStr(t["assigned_agent"])}`;
  const lines = [head, `   request : ${pyStr(t["request_text"])}`];
  if (pyTruthy(t["response_text"])) lines.push(`   response: ${pyStr(t["response_text"])}`);
  return lines.join("\n");
}

export function ticketCommand(db: () => Database, agent: string, argv: string[]): ScriptResult {
  const sub = argv[0];
  if (sub === undefined) return usageError("the following arguments are required: cmd");
  if (!SUBCOMMANDS.includes(sub)) {
    return usageError(`argument cmd: invalid choice: ${pyRepr(sub)} (choose from ${SUBCOMMANDS.map((c) => `'${c}'`).join(", ")})`);
  }
  if (!OURS.includes(sub)) return refused("ticket", sub, OURS);
  const a = parseArgv(SPECS[sub]!, argv.slice(1));
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
    description: "Read, keep alive and answer a user ticket the Capitano assigned you: show <id>, touch <id>, resolve <id> --response \"...\".",
    run: (args) => ticketCommand(options.db, options.agent, args),
  });
}
