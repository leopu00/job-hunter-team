/**
 * The Python skills a product role runs as native tools, keyed by the skill
 * that names them in `agents/<role>/skills.list`.
 *
 * A role gets a tool only when it lists the skill: a tool is a schema in every
 * request, and a role that never coordinates Scouts should not pay for
 * `scout_coord` on each call.
 */

import { join } from "node:path";

import { EnrichmentPolicy } from "../../db/enrichment-policy.ts";
import type { Database } from "../../db/jobs-db.ts";
import { dbPolicyFor, roleOf } from "../../db/role-policy.ts";
import { createDbTools } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { createEmailMonitorTool } from "./email-monitor.ts";
import { createFeedbackQueryTool } from "./feedback-query.ts";
import { createCaptainTools } from "./captain.ts";
import { createDeadlineExtractTool } from "./deadline-extract.ts";
import { createEnrichmentPolicyTool } from "./enrichment-policy.ts";
import { createLogoFetchTool } from "./logo-fetch.ts";
import { createRecheckLivenessTool } from "./recheck-liveness.ts";
import { createRoleRegistryTool } from "./role-registry.ts";
import { createSafeFetchTool } from "./safe-fetch.ts";
import { createSalaryEstimateTool } from "./salary-estimate.ts";
import { createScoutCoordTool } from "./scout-coord.ts";
import { createTicketTool } from "./ticket.ts";
import { SafeHttpsClient } from "../../../../../api-worker/src/safe-http.ts";

/** The team database, opened by the runtime. No tool chooses the file. */
export interface JobsDbHandle {
  open: () => Database;
  path: string;
}

export interface SkillToolsOptions {
  /** Skill names from `skills.list`. */
  skills: string[];
  /** The agent the tools act for: `scout-1`. */
  agent: string;
  jobsDb?: JobsDbHandle | undefined;
  /** `$JHT_HOME`, as the scripts read it. */
  jhtHome?: string | undefined;
  /** Where `scout-dedup.log` goes: the runtime's logs, not the person's JHT home. */
  dedupLog?: string | undefined;
  /** The person's profile folder: `db_insert score` checks `candidate_profile.yml` there first. */
  profileDir?: string | undefined;
  /** The runtime's state root: the salary cache is read from `<stateDir>/cache/`. */
  stateDir?: string | undefined;
  /** Test seam for the network tools: a scripted resolver and transport. */
  client?: SafeHttpsClient;
}

/**
 * Scripts a role's prompt runs without a skill that lists them (analista.md
 * RULE-15 tickets, step 5 deadlines, step 8 categories): the role gets them.
 */
const ROLE_SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  analista: ["ticket", "role_registry", "deadline_extract"],
  // T21: capitano.md C-06 reads the person's standing orders at every wake; the enrichment
  // policy is its to show (`set` is refused here: the profile is read-only), and the
  // email check of C-17 runs without the skill listed; C-15 drains the ticket queue, C-17 merges categories.
  capitano: ["team_directives", "enrichment_policy", "email_monitor", "ticket", "role_registry"],
  // T25: the CRITICO lists no database skill, and its prompt reads the application it was
  // asked to review and the team's recent activity (critico.md, communication section).
  critico: ["db_query"],
};

/** The script→tool overrides a role's text is rewritten with: whose tool a script is, for this role. */
export function scriptOverrides(skills: readonly string[]): Record<string, string> {
  // office-geocoding needs safe_fetch's own flags (--user-agent for Nominatim, --status).
  return skills.includes("office-geocoding") ? { "safe_fetch.py": "safe_fetch" } : {};
}

export function createSkillTools(options: SkillToolsOptions): ToolHandler[] {
  const listed = new Set(options.skills);
  const tools: ToolHandler[] = [];
  const db = options.jobsDb;
  if (db && listed.has("scout-coord")) tools.push(createScoutCoordTool({ agent: options.agent, db: db.open, dbPath: db.path }));
  if (db && listed.has("feedback-query")) tools.push(createFeedbackQueryTool({ db: db.open, jhtHome: options.jhtHome }));
  const scripts = new Set(ROLE_SCRIPTS[roleOf(options.agent)] ?? []);
  if (listed.has("email-monitor") || scripts.has("email_monitor")) tools.push(createEmailMonitorTool({ jhtHome: options.jhtHome }));
  // The enrichment policy lives in the person's profile; without it, the care-mode work is off.
  const policy = options.profileDir ? new EnrichmentPolicy(options.profileDir) : undefined;
  // T6: the DB skills. A role whose prompt inserts something other than a position gets
  // db_insert even without the skill listed (the ANALISTA's companies, RULE-08); scout_dedup
  // only with a position insert, which the check always precedes.
  if (db) {
    const inserts = dbPolicyFor(options.agent).insert;
    const wanted = new Set<string>();
    if (listed.has("db-query") || scripts.has("db_query")) wanted.add("db_query");
    if (listed.has("db-insert") || inserts.some((e) => e !== "position")) wanted.add("db_insert");
    if (listed.has("db-insert") && inserts.includes("position")) wanted.add("scout_dedup");
    if (listed.has("db-update")) wanted.add("db_update");
    const dbTools = createDbTools({
      db: db.open,
      agent: options.agent,
      ...(options.dedupLog ? { dedupLog: options.dedupLog } : {}),
      ...(options.profileDir ? { profilePath: join(options.profileDir, "candidate_profile.yml") } : {}),
      ...(policy ? { policy } : {}),
    });
    tools.push(...dbTools.filter((t) => wanted.has(t.spec.name)));
  }
  // T14: the ANALISTA's scripts.
  const client = options.client ?? new SafeHttpsClient();
  if (listed.has("recheck-liveness")) tools.push(createRecheckLivenessTool({ client }));
  if (listed.has("office-geocoding")) tools.push(createSafeFetchTool({ client }));
  if (scripts.has("deadline_extract")) tools.push(createDeadlineExtractTool());
  if (db) {
    if (scripts.has("ticket")) tools.push(createTicketTool({ db: db.open, agent: options.agent }));
    if (scripts.has("role_registry")) tools.push(createRoleRegistryTool({ db: db.open, agent: options.agent }));
    if (listed.has("salary-estimate")) {
      tools.push(
        createSalaryEstimateTool({ db: db.open, ...(options.stateDir ? { cacheFile: join(options.stateDir, "cache", "salary_estimates.json") } : {}) }),
      );
    }
    if (listed.has("logo-extraction")) tools.push(createLogoFetchTool({ db: db.open, client, policy }));
  }
  if ((listed.has("logo-extraction") || scripts.has("enrichment_policy")) && policy) tools.push(createEnrichmentPolicyTool(policy));
  // T21, the CAPITANO's own scripts. Its diary is the team's state, in the runtime's
  // state root: never the person's profile, which the runtime mounts read-only.
  if (listed.has("format-time") || listed.has("captain-diary") || scripts.has("team_directives")) {
    const captain = createCaptainTools({
      teamDir: join(options.stateDir ?? options.jhtHome ?? ".", "team"),
      ...(options.profileDir ? { profileDir: options.profileDir } : {}),
      // The zone the TUI's format_time.py reads first; host.env is the host's, not mounted here.
      ...(process.env["JHT_USER_TZ"] ? { userTz: process.env["JHT_USER_TZ"] } : {}),
      ...(db && scripts.has("team_directives") ? { db: db.open } : {}),
    });
    const want = (name: string) =>
      (name === "format_time" && listed.has("format-time")) || (name === "captain_diary" && listed.has("captain-diary")) || (name === "team_directives" && scripts.has("team_directives"));
    tools.push(...captain.filter((t) => want(t.spec.name)));
  }
  return tools;
}
