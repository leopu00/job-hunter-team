/**
 * The Python skills a product role runs as native tools, keyed by the skill
 * that names them in `agents/<role>/skills.list`.
 *
 * A role gets a tool only when it lists the skill: a tool is a schema in every
 * request, and a role that never coordinates Scouts should not pay for
 * `scout_coord` on each call.
 */

import type { Database } from "../../db/jobs-db.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { createEmailMonitorTool } from "./email-monitor.ts";
import { createFeedbackQueryTool } from "./feedback-query.ts";
import { createScoutCoordTool } from "./scout-coord.ts";

/** The team database, opened by the runtime. No tool chooses the file. */
export interface JobsDbHandle {
  open: () => Database;
  path: string;
}

export interface SkillToolsOptions {
  /** Skill names from `skills.list`. */
  skills: string[];
  jobsDb?: JobsDbHandle | undefined;
  /** `$JHT_HOME`, as the scripts read it. */
  jhtHome?: string | undefined;
}

export function createSkillTools(options: SkillToolsOptions): ToolHandler[] {
  const listed = new Set(options.skills);
  const tools: ToolHandler[] = [];
  const db = options.jobsDb;
  if (db && listed.has("scout-coord")) tools.push(createScoutCoordTool({ db: db.open, dbPath: db.path }));
  if (db && listed.has("feedback-query")) tools.push(createFeedbackQueryTool({ db: db.open, jhtHome: options.jhtHome }));
  if (listed.has("email-monitor")) tools.push(createEmailMonitorTool({ jhtHome: options.jhtHome }));
  return tools;
}
