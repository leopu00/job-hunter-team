/**
 * An agent's home folder: where it stands when it is spawned.
 *
 * Mirrors the TUI container layout: JHT binds `~/.jht` to `/jht_home` and
 * starts each agent in `agents/<role>/`, holding only its identity file and
 * its skills; the API runtime does the same under `~/.jht-api`. Running bare,
 * the folder is the same on the host, so a session here starts from what a
 * real spawn would see.
 *
 * Everything else in the folder is the agent's own work — files it copied in,
 * notes it wrote — and a fresh spawn removes it.
 */

import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HarnessError } from "./errors.ts";

/** Written by us into every home we create. Only a marked folder is ever emptied. */
export const HOME_MARKER = ".jht-api-agent";
export const IDENTITY_FILE = "AGENTS.md";
export const SKILLS_DIR = "skills";

export interface AgentHomeOptions {
  /** Absolute path of the home, e.g. `~/.jht-api/agents/scout`. */
  dir: string;
  role: string;
  /** Repo folder whose contents become `skills/`. Missing means no skills. */
  skillsSource?: string;
  /** Empty the home first, as a first spawn would find it. */
  fresh: boolean;
}

/**
 * Creates the home, or empties it when `fresh`, and installs the skills. The
 * identity is written separately with `writeIdentity`, once the prompt exists.
 */
export async function prepareAgentHome(options: AgentHomeOptions): Promise<void> {
  const { dir, role } = options;
  const existing = await entries(dir);

  if (existing !== null && existing.length > 0 && !existing.includes(HOME_MARKER)) {
    throw new HarnessError(
      "config_invalid",
      `${dir} is not empty and was not created by the Job Hunter Team agent runtime; refusing to use it as the ${role} home.`,
    );
  }

  if (options.fresh && existing !== null) {
    for (const name of existing) await rm(join(dir, name), { recursive: true, force: true });
  }

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, HOME_MARKER), `${JSON.stringify({ role })}\n`, "utf8");

  if (options.skillsSource && (await isDirectory(options.skillsSource))) {
    await rm(join(dir, SKILLS_DIR), { recursive: true, force: true });
    await cp(options.skillsSource, join(dir, SKILLS_DIR), { recursive: true });
  }
}

/** The exact system prompt, so what the agent is told is visible in its folder. */
export async function writeIdentity(dir: string, prompt: string): Promise<void> {
  await writeFile(join(dir, IDENTITY_FILE), `${prompt}\n`, "utf8");
}

async function entries(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
