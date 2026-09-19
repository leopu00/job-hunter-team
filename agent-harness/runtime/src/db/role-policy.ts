/**
 * What each product role may do in the team's database, by subcommand.
 *
 * The Python scripts let anyone run anything: in the TUI the boundary is the
 * prompt ("NEVER touch `scores`", RULE-08). An API agent gets the same tools
 * with the boundary in code: a subcommand its role's prompt and skills never
 * use is refused with the reason, before any SQL. The lists come from each
 * role's prompt and skills (`agents/<role>/`), and grow with the roles ported.
 *
 * The role is the agent's name without its instance number (`analista-2` →
 * `analista`), the same rule `start-agent.sh` names sessions by.
 */

import { agentInstanceId } from "../core/agent-id.ts";

export interface DbRolePolicy {
  /** db_query subcommands. */
  query: readonly string[];
  /** db_insert entities. */
  insert: readonly string[];
  /** db_update entities. */
  update: readonly string[];
}

const NONE: DbRolePolicy = { query: [], insert: [], update: [] };

export const DB_ROLE_POLICIES: Readonly<Record<string, DbRolePolicy>> = {
  // SC-03: inserts positions, excludes its own duplicates, reads.
  scout: { query: ["check-url", "position", "positions", "recent-activity"], insert: ["position"], update: ["position"] },
  // T14, analista.md MAIN LOOP and RULE-08/12/13/14: the `new` queue and the on-demand
  // queues, the category registry, companies. Never scores or applications.
  analista: {
    query: [
      "check-url", "position", "positions", "recent-activity", "company", "companies", "stats", "check-history",
      "next-for-analista", "next-for-recheck", "next-for-categorize", "next-for-salary-precise", "next-for-geocoding",
      "active-categories", "other-pile", "category-sizes",
    ],
    insert: [],
    update: [],
  },
  // T15 (FULLSTACK-1), scorer.md RULE-02/03/04/06: its queue and the position it scores.
  scorer: { query: ["next-for-scorer", "position"], insert: [], update: [] },
};

/** `analista-2` → `analista`. */
export function roleOf(agent: string): string {
  return agentInstanceId(agent).replace(/-\d+$/, "");
}

/** The policy of an agent's role; a role not listed here may do nothing. */
export function dbPolicyFor(agent: string): DbRolePolicy {
  return DB_ROLE_POLICIES[roleOf(agent)] ?? NONE;
}
