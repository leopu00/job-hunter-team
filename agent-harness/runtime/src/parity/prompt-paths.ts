/**
 * The paths a TUI prompt names, pointed at where they are for an API agent.
 *
 * The TUI prompts and skills send the agent to documents by the paths of the
 * TUI container: `agents/_skills/<x>/SKILL.md` (relative to `/app`),
 * `../_manual/…` (relative to an agent folder that has no `_manual` beside
 * it, even in the TUI), `/app/…`, `/jht_home/jobs.db`. In T5-bis the API
 * SCOUT built `/jht_home/agents/_skills/<x>/SKILL.md` out of them and spent
 * three rounds on files that do not exist. This rewrite sends every such
 * reference to a file the API agent can open: its own `skills/` for a skill
 * it has, the repo (`appRoot`) for any other document, the sibling `_team/`
 * for the team docs.
 *
 * Left as they are, on purpose: paths under `$JHT_HOME`/`/jht_home` that
 * name the person's data or the agent's own state (a profile, a queue, a
 * log it writes) — they depend on the box, not on the prompt — and
 * placeholders such as `<agent>`. `docs/parity.md` lists the rules.
 */

import { join } from "node:path";

export interface PromptPathOptions {
  /** The repo holding `agents/` and `shared/`: `/app` in the container. */
  appRoot: string;
  /** Skills materialized in the agent's home, under `skills/`. */
  homeSkills: ReadonlySet<string>;
  /** Where `scout-dedup.log` really is. */
  dedupLog: string;
}

/** A path segment: no spaces, quotes, backticks or closing brackets. */
const SEG = String.raw`[^\s\`'"()\[\]<>|;,]+`;

export function createPathRewriter(options: PromptPathOptions): (text: string) => string {
  const app = options.appRoot.replace(/\/+$/, "");
  const skillPath = new RegExp(String.raw`(?<![\w./-])(?:(?:/app|/jht_home)/)?agents/_skills/([A-Za-z0-9_-]+)(/${SEG})?`, "g");
  const manual = new RegExp(String.raw`(?<![\w./-])(?:(?:\.\./)+|(?:/app/)?agents/)_manual/(${SEG})`, "g");
  const team = new RegExp(String.raw`(?<![\w./$-])(?:/app/)?agents/_team/(${SEG})`, "g");

  return (text) =>
    text
      .replace(skillPath, (_whole, skill: string, rest: string | undefined) =>
        options.homeSkills.has(skill) ? `skills/${skill}${rest ?? ""}` : `${app}/agents/_skills/${skill}${rest ?? ""}`,
      )
      .replace(manual, (_whole, file: string) => `${app}/agents/_manual/${file}`)
      .replace(team, (_whole, file: string) => `../_team/${file}`)
      .replace(/(?<![\w./-])\/app\//g, `${app}/`)
      .replace(/(?<![\w./-])\/jht_home\/logs\/scout-dedup\.log/g, options.dedupLog)
      .replace(/(?<![\w./-])\/jht_home\/jobs\.db/g, "the team database (reach it only through the db tools)");
}

/** The repo documents a rewritten text points at, for tests: every one must exist. */
export function documentPaths(text: string, appRoot: string): string[] {
  const app = appRoot.replace(/\/+$/, "");
  const found = new Set<string>();
  const patterns = [
    new RegExp(String.raw`(?<![\w./-])skills/[A-Za-z0-9_-]+(?:/${SEG})?`, "g"),
    new RegExp(String.raw`(?<![\w./-])\.\./_team/${SEG}`, "g"),
    new RegExp(`${app.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${SEG}`, "g"),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const path = m[0].replace(/[.:]+$/, "");
      // Placeholders and globs name a family of files, not one.
      if (/[<>*{}$]/.test(path)) continue;
      found.add(path);
    }
  }
  return [...found];
}

/** Where a document path from `documentPaths` lives on disk, for an agent standing in `homeDir`. */
export function onDisk(path: string, homeDir: string): string {
  return path.startsWith("/") ? path : join(homeDir, path);
}
