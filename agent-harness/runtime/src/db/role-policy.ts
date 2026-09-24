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

import { join } from "node:path";

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
  /** What `db_update application` may change; absent when the role has no application update. */
  application?: ApplicationUpdateRule;
}

/**
 * The fields and statuses a role's `db_update application` may write. As for
 * a position, what is allowed is checked before the call and bound into the
 * UPDATE's WHERE: the send and its outcome are nobody's here.
 */
export interface ApplicationUpdateRule {
  /** Flags it may pass (attribute names: `cv_pdf_path`). */
  fields: readonly string[];
  /** The application statuses it may set. */
  statuses: readonly string[];
  /** A status it may set only together with these flags: `ready` takes the Critic's verdict. */
  statusNeeds?: Readonly<Record<string, readonly string[]>>;
  /** Said when a call is refused: what this role's update is for. */
  purpose: string;
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
  // T25, scrittore.md: the user-requested CV, its application row and the final gate.
  // It never touches scores, companies, highlights, the analysis notes, nor the send
  // (applied/response), which are the person's and the CAPITANO's ("DB boundaries").
  scrittore: {
    query: ["next-for-scrittore", "position", "application", "recent-activity", "check-url"],
    insert: ["application"],
    update: ["position", "application"],
    position: {
      fields: ["status", "notes"],
      moves: { writing: ["scored"], ready: ["writing"], excluded: ["scored", "writing"] },
      onlyWith: { notes: "excluded" },
      touches: ["scored", "writing"],
      purpose:
        "The SCRITTORE claims a position the person asked a CV for (--status writing), excludes it with " +
        "the reason when the link is dead, and after the Critic's rounds moves it to ready or excluded " +
        "(application-flow steps 3, 4 and 7).",
    },
    application: {
      fields: [
        "cv_path", "cv_pdf_path", "cl_path", "cl_pdf_path", "written_at",
        "critic_verdict", "critic_score", "critic_round", "critic_notes", "reviewed_by", "status",
      ],
      statuses: ["draft", "review", "ready"],
      // The single-writer rule (application-flow, bug #21): `ready` is the verdict's own call.
      statusNeeds: { ready: ["critic_verdict"] },
      purpose:
        "The SCRITTORE owns its application: the CV and cover-letter paths, the Critic's rounds and the " +
        "final ready. Marking it sent (--applied, --applied-at, --applied-via) or answered (--response) " +
        "is the person's and the CAPITANO's.",
    },
  },
  // T25, critico.md: a blind review, one per run. It writes NOTHING in the database —
  // its verdict is a file under the deliverables and one [RES] to the Scrittore, which
  // persists it (application-flow "single-writer rule", bug #21). `application` is the
  // state it pulls; `next-for-critico` is how it finds the review it was asked for,
  // where the TUI had it spawned with the request in hand.
  critico: {
    query: ["next-for-critico", "application", "position", "recent-activity"],
    insert: [],
    update: [],
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
  // T39, closer.md: the only role that acts outward, and the one whose write is
  // the most irreversible — an application leaves the box under the person's name.
  // It READS its queue and the rows behind it; the only thing it writes is the
  // answers it works out, and that goes through `application_answers`, never here.
  // The sent state is not in this table on purpose and could not be: `--applied`,
  // `--applied-at` and `--applied-via` are not ported at all (db-update.ts), so in
  // this harness NO role can mark an application sent. CL-02 — "no receipt, no
  // applied" — is not a rule to obey here, it is a thing that cannot be done.
  closer: {
    query: ["position", "application", "recent-activity"],
    insert: [],
    update: [],
  },
  // T40, mentor.md M-04 ("Read-only. Never db_insert.py / db_update.py") and its
  // `mentor-patterns` skill: it watches SETS of records — the latest positions,
  // the exclusions, the outcome funnel of what was sent (Pattern D) — and reads
  // the board before stating a number (M-05). It writes nothing, anywhere: the
  // one voice that tells the person to stop and learn a craft must not be able
  // to move the pipeline it is judging.
  mentor: {
    query: ["positions", "position", "applications", "application", "dashboard", "stats", "recent-activity"],
    insert: [],
    update: [],
  },
  // T41, mantenitore.md: its `skills.list` names no database skill at all — its
  // object of work is the infrastructure, and here the infrastructure is not its
  // to touch either. It reads nothing and writes nothing in the team's database.
  mantenitore: { query: [], insert: [], update: [] },
  // T37, sentinella.md RULE #0 ("DO NOT modify code, config, files, git"): the SENTINELLA
  // does not touch the database at all — not a read, not a write. Its whole data layer is
  // the bridges' JSONL under the team's home, and what it produces is one piece of advice
  // to the CAPITANO, who is the one that queries anything ("you ADVISE, he DECIDES").
  // Written out although an absent role may already do nothing: an unwritten rule is one
  // no test can hold, and this is the role whose defect would be reaching where it must not.
  sentinella: {
    query: [],
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
  // T41, dottore.md: the archivist. In the TUI it lists `db-query` to "recover task
  // context before respawning a crashed agent" — and there are no respawns here, because
  // there are no sessions to crash: the MASTER's decision of 23/09 leaves this role
  // without the right to stop or restart anyone. What is left of that skill is the
  // overview a retrospective is written against, and only that. It writes nothing
  // anywhere in the database: a role whose whole output is a record of what the others
  // did must not be able to change what they did.
  dottore: {
    query: ["dashboard", "stats", "recent-activity"],
    insert: [],
    update: [],
  },
  // T38, assistente.md: the one role that talks to the person. It reads the
  // database to answer them ("how many positions are ready?") and writes
  // NOTHING there — its own line says so: "The Assistente never writes to the
  // DB". What it does write is the person's profile, which is not in here.
  assistente: {
    query: ["dashboard", "recent-activity", "stats", "positions", "position", "applications", "application"],
    insert: [],
    update: [],
  },
};

/**
 * What the ASSISTENTE writes inside the person's profile folder (T38, P2 of
 * SICUREZZA). Not the folder: the files.
 *
 * On a real box that folder holds more than the profile — dated backups,
 * `applications/`, `audits/`, control flags of other roles, and scripts the
 * TUI skills run from there. Write access to the whole folder would have given
 * this role three powers nobody asked for: rewriting a script another role
 * executes, flipping a control flag, and overwriting the person's own backups.
 * Today none of them is live here (nothing runs from the profile and the image
 * has no interpreter), but the permission is written in the runtime, and the
 * runtime is what ends up where those things do exist.
 *
 * The list is what the role's own prompt and skills write, counted in them:
 * the profile, the four narrative summaries, the folder where an uploaded
 * document is archived, and its two named flags — `ready.flag` is the "go to
 * dashboard" button, `welcomed.flag` the Telegram welcome handshake
 * (assistente.md § welcome). `inbox/` is left out on purpose: there the
 * tg-bridge writes and this role reads.
 */
export const PROFILE_WRITABLE: readonly string[] = ["candidate_profile.yml", "ready.flag", "welcomed.flag", "summaries", "sources"];

/**
 * The paths of the profile folder this agent may write, absolute. Empty for
 * every role but the ASSISTENTE: it is the only agent that talks to the person
 * and the only one allowed to write down what they said.
 */
export function profileWritables(profileDir: string, agent: string): string[] {
  if (roleOf(agent) !== "assistente") return [];
  return PROFILE_WRITABLE.map((name) => join(profileDir, name));
}

/** `analista-2` → `analista`. */
export function roleOf(agent: string): string {
  return agentInstanceId(agent).replace(/-\d+$/, "");
}

/** The policy of an agent's role; a role not listed here may do nothing. */
export function dbPolicyFor(agent: string): DbRolePolicy {
  return DB_ROLE_POLICIES[roleOf(agent)] ?? NONE;
}
