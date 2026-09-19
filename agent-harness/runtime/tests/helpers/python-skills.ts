/**
 * The Python skills the DB tools are ported from, for parity tests.
 *
 * The port is judged against the Python it replaces, at the commit
 * `src/db/schema.sql` was dumped from: the same commit the schema comes from
 * is the one whose behaviour the tools copy. `git archive` extracts
 * `shared/skills` at that commit once per test file; tests that need it skip
 * where python3 or the commit is missing (the image has neither), and run
 * everywhere else.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = join(RUNTIME, "..", "..");

/** The commit named in schema.sql's header. */
export const SOURCE_COMMIT = /^-- source: \S+ ([0-9a-f]{7,40})$/m.exec(
  readFileSync(join(RUNTIME, "src", "db", "schema.sql"), "utf8"),
)?.[1];

let extracted: string | null | undefined;

/** `shared/skills` at `SOURCE_COMMIT`, extracted to a temporary folder; null when it cannot be. */
export function pythonSkills(): string | null {
  if (extracted !== undefined) return extracted;
  extracted = null;
  if (!SOURCE_COMMIT || !works("python3", ["--version"]) || !works("git", ["cat-file", "-e", `${SOURCE_COMMIT}^{commit}`])) {
    return extracted;
  }
  const dir = mkdtempSync(join(tmpdir(), "jht-py-skills-"));
  // Through a file, not a pipe: tar stops reading at the end-of-archive marker
  // and closes its stdin while git's padding is still being written (EPIPE).
  const archive = join(dir, "skills.tar");
  execFileSync("git", ["archive", `--output=${archive}`, SOURCE_COMMIT, "shared/skills"], { cwd: REPO });
  execFileSync("tar", ["-xf", archive, "-C", dir]);
  extracted = join(dir, "shared", "skills");
  return extracted;
}

export interface PyRun {
  stdout: string;
  stderr: string;
  status: number;
}

/** Runs a script from the extracted skills, the way an agent would. Never throws on a non-zero exit. */
export function runPython(skills: string, args: string[], env: Record<string, string> = {}, input?: string): PyRun {
  try {
    const stdout = execFileSync("python3", args, {
      cwd: skills,
      env: { PATH: process.env["PATH"] ?? "", PYTHONIOENCODING: "utf-8", ...env },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...(input === undefined ? {} : { input }),
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? -1 };
  }
}

function works(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { cwd: REPO, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
