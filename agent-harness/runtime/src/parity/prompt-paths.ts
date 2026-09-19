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
 * for the team docs. Every one is absolute: in T5-ter a bare `skills/<x>`
 * beside `/app/agents/_manual/…` became `/app/agents/_manual/skills/<x>`.
 *
 * The person's profile goes where the runtime has it (`JHT_API_PROFILE_DIR`):
 * the TUI names it `$JHT_HOME/profile`, and in the API container `JHT_HOME`
 * is not set, so in T5-ter the SCOUT never read it and searched on the prompt
 * alone.
 *
 * Left as they are, on purpose: other paths under `$JHT_HOME`/`/jht_home`
 * that name the agent's own state (a queue, a log it writes) — they depend on
 * the box, not on the prompt — and placeholders such as `<agent>`.
 * `docs/parity.md` lists the rules.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export interface PromptPathOptions {
  /** The repo holding `agents/` and `shared/`: `/app` in the container. */
  appRoot: string;
  /** Skills materialized in the agent's home, under `skills/`. */
  homeSkills: ReadonlySet<string>;
  /** Where `scout-dedup.log` really is. */
  dedupLog: string;
  /** The agent's home: skills it has are under `<homeDir>/skills/`. */
  homeDir: string;
  /** The person's profile folder, as the runtime has it. */
  profileDir: string;
  /** The person's locale: a team doc's `<name>.<locale>.md` wins over `<name>.md`, as the launcher copies it. */
  locale?: string;
}

/** A path segment: no spaces, quotes, backticks or closing brackets. */
const SEG = String.raw`[^\s\`'"()\[\]<>|;,]+`;

export function createPathRewriter(options: PromptPathOptions): (text: string) => string {
  const app = options.appRoot.replace(/\/+$/, "");
  const home = options.homeDir.replace(/\/+$/, "");
  const profileDir = options.profileDir.replace(/\/+$/, "");
  // `$JHT_HOME/profile`, `${JHT_HOME}`, `${JHT_HOME:-…}`, `/jht_home/profile`, `~/.jht/profile`.
  const profile = /(?<![\w./-])(?:\$JHT_HOME|\$\{JHT_HOME(?::?-[^}]*)?\}|\/jht_home|~\/\.jht)\/profile(?![\w.-])/g;
  const skillPath = new RegExp(String.raw`(?<![\w./-])(?:(?:/app|/jht_home)/)?agents/_skills/([A-Za-z0-9_-]+)(/${SEG})?`, "g");
  const manual = new RegExp(String.raw`(?<![\w./-])(?:(?:\.\./)+|(?:/app/)?agents/)_manual/(${SEG})`, "g");
  // `agents/_team/…` and the TUI's relative `../_team/…`. The copy beside the
  // home is another role's state to the permission policy, so it goes to the repo.
  const team = new RegExp(String.raw`(?<![\w./$-])(?:(?:/app/)?agents/|(?:\.\./)+)_team/(${SEG})`, "g");
  const teamDoc = (file: string) => {
    const localized = options.locale && options.locale !== "en" ? file.replace(/\.md$/, `.${options.locale}.md`) : file;
    return existsSync(join(app, "agents", "_team", localized)) ? localized : file;
  };

  return (text) =>
    text
      .replace(skillPath, (_whole, skill: string, rest: string | undefined) =>
        options.homeSkills.has(skill) ? `${home}/skills/${skill}${rest ?? ""}` : `${app}/agents/_skills/${skill}${rest ?? ""}`,
      )
      .replace(manual, (_whole, file: string) => `${app}/agents/_manual/${file}`)
      .replace(team, (_whole, file: string) => `${app}/agents/_team/${teamDoc(file)}`)
      .replace(/(?<![\w./-])\/app\//g, `${app}/`)
      .replace(profile, profileDir)
      .replace(/(?<![\w./-])\/jht_home\/logs\/scout-dedup\.log/g, options.dedupLog)
      .replace(/(?<![\w./-])\/jht_home\/jobs\.db/g, "the team database (reach it only through the db tools)");
}

/** The repo documents a rewritten text points at, for tests: every one must exist. */
export function documentPaths(text: string, appRoot: string, otherRoots: string[] = []): string[] {
  const app = appRoot.replace(/\/+$/, "");
  const found = new Set<string>();
  const escape = (root: string) => root.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(String.raw`(?<![\w./-])skills/[A-Za-z0-9_-]+(?:/${SEG})?`, "g"),
    new RegExp(String.raw`(?<![\w./-])(?:\.\./)+_team/${SEG}`, "g"),
    // Anchored like the rewrites: `web/app/api/…` is not `/app/api/…` when the root is `/app`.
    new RegExp(`(?<![\\w./-])${escape(app)}/${SEG}`, "g"),
    ...otherRoots.map((root) => new RegExp(`(?<![\\w./-])${escape(root)}/${SEG}`, "g")),
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
