/**
 * A product role's prompt, built the way the TUI launcher builds it.
 *
 * The TUI agents get their identity from `.launcher/start-agent.sh`: the
 * template `agents/<role>/<role>.<locale>.md` (falling back to `<role>.md`)
 * becomes the `CLAUDE.md`/`AGENTS.md` of the agent's folder, the skills named
 * in `agents/<role>/skills.list` plus the role's private `agents/<role>/_skills`
 * are copied next to it with `SKILL.<locale>.md` winning over `SKILL.md`, and
 * the team docs of `agents/_team` land in `../_team` so the prompt's relative
 * links resolve. The CLI then reads the identity file and lists the skills to
 * the model by name and description.
 *
 * An API agent has no CLI to do the reading, so this module does it: the same
 * files, chosen by the same rules, in the same order. Anything the API agent is
 * told that a TUI agent is not lives in `parityNotes` and is documented in
 * `docs/parity.md` — the prompt diff against a live TUI agent must show only
 * those.
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { HarnessError } from "../core/errors.ts";

/** The locales the launcher accepts; anything else falls through the cascade. */
export const LOCALES = ["en", "it", "hu", "es", "de", "fr", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

/** Where the skills live inside the agent's home. The TUI uses `.claude/skills`. */
export const HOME_SKILLS_DIR = "skills";
/** Written next to the skills so what the model was told is visible in its folder. */
export const HOME_IDENTITY_FILE = "AGENTS.md";

export interface SkillEntry {
  name: string;
  /** From the `description:` line of the SKILL.md front matter. */
  description: string;
  /** The skill folder in the repo. */
  sourceDir: string;
  /** The SKILL.md chosen for the locale: the localized one, or the baseline. */
  sourceFile: string;
}

export interface TeamDoc {
  /** File name under `_team/`, always the baseline name (`team-rules.md`). */
  name: string;
  /** The file copied under that name: the localized variant when there is one. */
  sourceFile: string;
}

export interface RolePrompt {
  role: string;
  locale: Locale;
  /** The template the identity was read from. */
  templatePath: string;
  /** The identity file, byte for byte what a TUI agent finds in its CLAUDE.md. */
  identity: string;
  skills: SkillEntry[];
  teamDocs: TeamDoc[];
  /** Names listed in skills.list with no folder behind them. The launcher warns and goes on. */
  missingSkills: string[];
}

/**
 * The user's locale, by the cascade of `jht_spawn_user_locale` in
 * `.launcher/spawn-lib.sh`: `i18n-prefs.json`, then `$JHT_LANG`, then
 * `JHT_LANG=` in `host.env`, then English. An unknown value at any step is
 * skipped, not an error — the launcher does the same.
 */
export async function resolveUserLocale(options: {
  jhtHome: string;
  env?: Record<string, string | undefined>;
}): Promise<Locale> {
  const env = options.env ?? process.env;

  const prefs = await readText(join(options.jhtHome, "i18n-prefs.json"));
  if (prefs !== null) {
    try {
      const locale = asLocale((JSON.parse(prefs) as { locale?: unknown }).locale);
      if (locale) return locale;
    } catch {
      // An unreadable prefs file is skipped, as `jq` failing is in the launcher.
    }
  }

  const fromEnv = asLocale(env["JHT_LANG"]);
  if (fromEnv) return fromEnv;

  const hostEnv = await readText(join(options.jhtHome, "host.env"));
  if (hostEnv !== null) {
    const line = hostEnv.split("\n").find((l) => l.startsWith("JHT_LANG="));
    const locale = asLocale(line?.slice("JHT_LANG=".length).replaceAll('"', ""));
    if (locale) return locale;
  }

  return "en";
}

/** Reads the role's identity, skills and team docs from the repo at `appRoot`. */
export async function loadRolePrompt(options: { appRoot: string; role: string; locale: Locale }): Promise<RolePrompt> {
  const { appRoot, role, locale } = options;
  // A role names a folder under agents/: nothing that could climb out of it.
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(role)) {
    throw new HarnessError("config_invalid", `"${role}" is not a role name: lowercase letters, digits, - and _.`);
  }
  const roleDir = join(appRoot, "agents", role);

  const localized = join(roleDir, `${role}.${locale}.md`);
  const baseline = join(roleDir, `${role}.md`);
  const templatePath = (await isFile(localized)) ? localized : baseline;
  const identity = await readText(templatePath);
  if (identity === null) {
    throw new HarnessError("config_invalid", `No prompt for role "${role}": ${baseline} does not exist.`);
  }

  const skills: SkillEntry[] = [];
  const missingSkills: string[] = [];
  const add = async (name: string, sourceDir: string) => {
    const entry = await readSkill(name, sourceDir, locale);
    if (!entry) return false;
    // A private skill with the name of a shared one replaces it, as the second
    // `cp -R` over the same destination does in the launcher.
    const at = skills.findIndex((s) => s.name === name);
    if (at >= 0) skills[at] = entry;
    else skills.push(entry);
    return true;
  };

  for (const name of parseSkillsList((await readText(join(roleDir, "skills.list"))) ?? "")) {
    if (!(await add(name, join(appRoot, "agents", "_skills", name)))) missingSkills.push(name);
  }
  for (const name of await sortedDirs(join(roleDir, "_skills"))) {
    if (name !== "_lib") await add(name, join(roleDir, "_skills", name));
  }

  return { role, locale, templatePath, identity, skills, teamDocs: await teamDocs(appRoot, locale), missingSkills };
}

/**
 * `skills.list`: one name per line, `#` starts a comment anywhere on the line,
 * whitespace is dropped, `_lib` is a dependency folder and never a skill.
 */
export function parseSkillsList(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const name = (line.split("#")[0] ?? "").replace(/\s+/g, "");
    if (name && name !== "_lib") names.push(name);
  }
  return names;
}

/**
 * The system prompt of an API agent: the identity untouched, then what the
 * harness adds — the parity notes and the skill index. The identity comes
 * first and whole so the prefix is the TUI prompt and caches across runs.
 */
export function composeSystemPrompt(
  prompt: RolePrompt,
  parityNotes: string,
  /** The agent's home: with it, the index names each SKILL.md by its absolute path (T10b). */
  homeDir?: string,
): string {
  const skillsDir = homeDir ? join(homeDir, HOME_SKILLS_DIR) : HOME_SKILLS_DIR;
  const index = prompt.skills
    .map((s) => `- ${s.name}: ${s.description} (${skillsDir}/${s.name}/SKILL.md)`)
    .join("\n");
  const skills =
    prompt.skills.length === 0
      ? ""
      : "\n\n# Skills\n\nThese skills are in your folder. When a task matches one, read its SKILL.md " +
        "before acting, as you would load a skill:\n\n" +
        index;
  const notes = parityNotes.trim() ? `\n\n${parityNotes.trim()}` : "";
  return `${prompt.identity.trimEnd()}${notes}${skills}\n`;
}

/**
 * Lays out the agent's home the way the launcher lays out a TUI agent's:
 * skills under `skills/<name>/` with the locale's SKILL.md as `SKILL.md` and no
 * other variant left, the team docs in the sibling `_team/`, and the system
 * prompt in `AGENTS.md`. Skills are replaced whole on every call, as the
 * launcher's `rm -rf` before copying does.
 */
export async function materializeRoleHome(
  prompt: RolePrompt,
  homeDir: string,
  system: string,
  /** Applied to every Markdown file copied (skills and team docs): how the API agent reads them. */
  rewrite: (text: string) => string = (text) => text,
): Promise<void> {
  const skillsDir = join(homeDir, HOME_SKILLS_DIR);
  await rm(skillsDir, { recursive: true, force: true });
  await mkdir(skillsDir, { recursive: true });

  for (const skill of prompt.skills) {
    const dest = join(skillsDir, skill.name);
    await cp(skill.sourceDir, dest, { recursive: true });
    if (skill.sourceFile !== join(skill.sourceDir, "SKILL.md")) {
      await cp(skill.sourceFile, join(dest, "SKILL.md"));
    }
    for (const name of await readdir(dest)) {
      if (/^SKILL\..+\.md$/.test(name)) await rm(join(dest, name), { force: true });
    }
    await rewriteMarkdown(dest, rewrite);
  }

  if (prompt.teamDocs.length > 0) {
    const teamDir = join(dirname(homeDir), "_team");
    await mkdir(teamDir, { recursive: true });
    for (const doc of prompt.teamDocs) await cp(doc.sourceFile, join(teamDir, doc.name));
    await rewriteMarkdown(teamDir, rewrite);
  }

  await writeFile(join(homeDir, HOME_IDENTITY_FILE), system, "utf8");
}

/**
 * The home the executor prepared, checked instead of rebuilt (T43).
 *
 * The boundary this serves is not in the runtime and cannot be: the role's
 * own process is what lays out its home today (`materializeRoleHome` runs
 * inside the container, with the role's uid), so a mount of `AGENTS.md` and
 * `skills/` as read-only makes the role fail to start — the `rm -rf` before
 * the copy dies with EBUSY, which is what VPS measured. A process does not
 * defend itself from itself: the layout has to be done OUTSIDE, by a uid that
 * is not the role's, and then mounted.
 *
 * This function is the runtime's half of that: with a home already prepared,
 * it rebuilds nothing and instead checks that what is on disk is EXACTLY what
 * this role should be reading — the composed system prompt, and every skill
 * as the rewrite leaves it, with no extra skill folder. On any difference the
 * role does NOT start and the error names the file: a run with a prompt
 * nobody verified is precisely what the mount is there to prevent, and a
 * silent fallback to rebuilding would hand it back.
 *
 * The switch is the executor's (`JHT_API_HOME_PREPARED`, set on the container
 * it starts): a role cannot turn it on for its own process. And turning it on
 * without the files being right buys nothing — the run stops.
 */
export async function verifyPreparedHome(prompt: RolePrompt, homeDir: string, system: string, rewrite: (text: string) => string): Promise<void> {
  const fail = (message: string): never => {
    throw new HarnessError(
      "config_invalid",
      `The home at ${homeDir} was declared already prepared (JHT_API_HOME_PREPARED), but ${message}. ` +
        "This role will not run on a prompt nobody verified: either the executor's copy is stale, or it is not the one for this role. " +
        "Nothing was rewritten here — a prepared home is read, never repaired.",
    );
  };
  // The marker the runtime writes on a home it made: with a prepared home it is
  // the executor's, and its absence means this folder is not a role's home at all.
  const marker = await readText(join(homeDir, ".jht-api-agent"));
  if (marker === null) fail("it carries no .jht-api-agent marker: the executor did not lay it out, or not here");
  const identity = await readText(join(homeDir, HOME_IDENTITY_FILE));
  if (identity === null) fail(`${HOME_IDENTITY_FILE} is missing`);
  if (identity !== system) {
    fail(`${HOME_IDENTITY_FILE} is not the prompt this role composes (${[...(identity ?? "")].length} characters on disk, ${[...system].length} expected)`);
  }

  const skillsDir = join(homeDir, HOME_SKILLS_DIR);
  const expected = new Map(prompt.skills.map((skill) => [skill.name, skill]));
  let present: string[];
  try {
    present = (await readdir(skillsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return void fail(`${HOME_SKILLS_DIR}/ is missing`);
  }
  // A folder nobody expected is text this role would read as its own instructions.
  const extra = present.filter((name) => !expected.has(name)).sort();
  if (extra.length > 0) fail(`${HOME_SKILLS_DIR}/ carries skills this role does not load: ${extra.join(", ")}`);
  for (const [name, skill] of expected) {
    const path = join(skillsDir, name, "SKILL.md");
    const onDisk = await readText(path);
    if (onDisk === null) fail(`${HOME_SKILLS_DIR}/${name}/SKILL.md is missing`);
    const source = await readText(skill.sourceFile);
    if (source === null) fail(`the image has no ${skill.name} to check ${HOME_SKILLS_DIR}/${name}/SKILL.md against`);
    if (onDisk !== rewrite(source ?? "")) fail(`${HOME_SKILLS_DIR}/${name}/SKILL.md is not what this role should read`);
  }
}

async function rewriteMarkdown(dir: string, rewrite: (text: string) => string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, "utf8");
    const next = rewrite(text);
    if (next !== text) await writeFile(path, next, "utf8");
  }
}

async function readSkill(name: string, sourceDir: string, locale: Locale): Promise<SkillEntry | null> {
  const baseline = join(sourceDir, "SKILL.md");
  if (!(await isDirectory(sourceDir))) return null;
  const localized = join(sourceDir, `SKILL.${locale}.md`);
  const sourceFile = locale !== "en" && (await isFile(localized)) ? localized : baseline;
  const text = (await readText(sourceFile)) ?? "";
  return { name, description: frontMatterField(text, "description") ?? "", sourceDir, sourceFile };
}

async function teamDocs(appRoot: string, locale: Locale): Promise<TeamDoc[]> {
  const dir = join(appRoot, "agents", "_team");
  let names: string[];
  try {
    names = (await readdir(dir)).sort();
  } catch {
    return [];
  }
  const docs: TeamDoc[] = [];
  for (const name of names) {
    // `*.??.md` are the localized variants; only baselines name a doc.
    if (!name.endsWith(".md") || /\.[a-z]{2}\.md$/.test(name)) continue;
    const localized = join(dir, `${basename(name, ".md")}.${locale}.md`);
    const sourceFile = locale !== "en" && (await isFile(localized)) ? localized : join(dir, name);
    docs.push({ name, sourceFile });
  }
  return docs;
}

/** One `key: value` from a `---` front matter block. Quotes around the value are dropped. */
export function frontMatterField(text: string, key: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match?.[1]) return null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.startsWith(`${key}:`)) continue;
    return line
      .slice(key.length + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  }
  return null;
}

function asLocale(value: unknown): Locale | null {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function sortedDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
