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
  /** What `db_update position` may change; absent when the role has no position update. */
  position?: PositionUpdateRule;
}

/**
 * The fields and status moves a role's `db_update position` may make. A move
 * is checked against the row's status in the UPDATE's own WHERE, so two
 * agents racing on one position cannot both move it.
 */
export interface PositionUpdateRule {
  /** Flags it may pass (attribute names: `last_checked`); `"*"` for every flag of the script. */
  fields: readonly string[] | "*";
  /** Target status → the statuses it may come from. */
  moves: Readonly<Record<string, readonly string[]>>;
  /** Flags that only go with one target status: the SCORER's notes are its exclusion reason. */
  onlyWith?: Readonly<Record<string, string>>;
  /** Only rows this agent found (the SCOUT's duplicate recovery, D-3). */
  ownRowsOnly?: boolean;
  /** The statuses a row must be in for any update of this role, a move or not; absent: any. */
  touches?: readonly string[];
  /**
   * Rows in these statuses take only these flags: past the analysis a
   * position is the Scorer's and the Scrittore's, and what is left to the
   * role is keeping it true (liveness, category, office) — never its text,
   * its link or its salary.
   */
  later?: { statuses: readonly string[]; fields: readonly string[] };
  /**
   * On a row in the `later` statuses, closing it (`--status excluded`, or
   * `--is-open false`) takes a recorded proof: the liveness check that
   * confirmed it closed, and its evidence (SICUREZZA A-3). A scored or ready
   * position is the Scorer's and the Scrittore's work already paid for.
   */
  laterCloseNeedsProof?: boolean;
  /** Said when a call is refused: what this role's update is for. */
  purpose: string;
}

const NONE: DbRolePolicy = { query: [], insert: [], update: [] };

export const DB_ROLE_POLICIES: Readonly<Record<string, DbRolePolicy>> = {
  // SC-03: inserts positions, excludes its own duplicates, reads.
  scout: {
    query: ["check-url", "position", "positions", "recent-activity"],
    insert: ["position"],
    update: ["position"],
    position: {
      fields: ["status", "notes"],
      moves: { excluded: ["new"] },
      ownRowsOnly: true,
      touches: ["new"],
      purpose: `The SCOUT's only update is the duplicate recovery: db_update position <ID> --status excluded --notes "DUPLICATE of #<ORIGINAL_ID>" (skill position-insert).`,
    },
  },
  // T14, analista.md MAIN LOOP and RULE-08/12/13/14: the `new` queue and the on-demand
  // queues, the category registry, companies. Never scores or applications.
  analista: {
    query: [
      "check-url", "position", "positions", "recent-activity", "company", "companies", "stats", "check-history",
      "next-for-analista", "next-for-recheck", "next-for-categorize", "next-for-salary-precise", "next-for-geocoding",
      "active-categories", "other-pile", "category-sizes",
      // Care mode, assigned by the Capitano (RULE-14), gated by the enrichment policy.
      "next-for-recheck-due", "next-for-recheck-weekly", "next-for-geocode-missing", "next-for-logo-missing",
    ],
    // RULE-08: the company registry and the position's highlights are the ANALISTA's to fill.
    insert: ["company", "highlight"],
    update: ["position", "company"],
    position: {
      // Every field: the analysis writes notes, summary, location, salary estimate,
      // category, liveness and office coordinates, and corrects what the Scout scraped.
      fields: "*",
      // new → checked | excluded is the analysis; a live position is excluded later only on
      // proof it closed (RULE-14 care mode). Never back to new, never past the Scorer's states
      // into the Scrittore's, never an application's.
      moves: { checked: ["new", "checked"], excluded: ["new", "checked", "scored", "writing", "review", "ready"] },
      // Nothing once applied or answered, nor on a position already excluded (SICUREZZA A-1).
      touches: ["new", "checked", "scored", "writing", "review", "ready"],
      later: {
        statuses: ["scored", "writing", "review", "ready"],
        fields: [
          // RULE-12/14 recheck: liveness, and the exclusion with its reason when closed.
          "status", "notes", "is_open", "last_open_check", "last_checked", "expires_at",
          // RULE-14 categorize runs on checked..ready; geocoding on any live position.
          "role_family", "office_lat", "office_lon", "office_address", "office_geocoded", "office_verified",
          "action", "outcome", "evidence_kind", "evidence_url", "evidence_code", "evidence_hash", "duration_ms",
        ],
      },
      laterCloseNeedsProof: true,
      purpose: "The ANALISTA moves a position new → checked or excluded, and excludes a later one only on proof it closed (analista.md RULE-06/14).",
    },
  },
  // T21, capitano.md: the CAPITANO watches the pipeline and routes work; it writes no
  // position, score or application (C-10: "the Captain does not write CVs"). Its writes are
  // its own state (diary) and, in the TUI, other agents' pace and lifecycle.
  capitano: {
    query: [
      "check-url", "position", "positions", "recent-activity", "company", "companies", "stats", "dashboard", "check-history",
      "next-for-analista", "next-for-scorer", "next-for-scrittore", "next-for-critico", "next-for-categorize",
      "next-for-recheck", "next-for-recheck-due", "next-for-geocode-missing", "next-for-logo-missing",
      "active-categories", "other-pile", "category-sizes",
    ],
    insert: [],
    update: [],
  },
  // T15 (FULLSTACK-1), scorer.md RULE-02/03/04/06: its queue and the position it scores.
  scorer: {
    query: ["next-for-scorer", "position"],
    // db_insert score: one row per position, behind profile_gate (T15).
    insert: ["score"],
    update: ["position"],
    position: {
      fields: ["status", "notes", "last_checked"],
      moves: { scored: ["checked"], excluded: ["checked"] },
      onlyWith: { notes: "excluded" },
      touches: ["checked"],
      purpose: "The SCORER claims a checked position (--last-checked now) and moves it to scored or excluded; notes go only with the exclusion (scorer.md RULE-02/03/04/06).",
    },
  },
};

/** `analista-2` → `analista`. */
export function roleOf(agent: string): string {
  return agentInstanceId(agent).replace(/-\d+$/, "");
}

/** The policy of an agent's role; a role not listed here may do nothing. */
export function dbPolicyFor(agent: string): DbRolePolicy {
  return DB_ROLE_POLICIES[roleOf(agent)] ?? NONE;
}
