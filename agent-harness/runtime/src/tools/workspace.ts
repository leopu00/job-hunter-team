/**
 * File tools: read, write, edit, glob, grep.
 *
 * Paths may be absolute, relative to the working folder, or start with `~`.
 * Nothing here is confined — reach is governed by the permission policy, which
 * sees every path through `classify` before the call runs. The tools keep the
 * results small and honest instead:
 *
 * - `read_file` numbers lines and reads a window, so a long file is paged, not
 *   dumped.
 * - `write_file` and `edit_file` answer with what changed, never with the
 *   content the model has just written.
 * - `glob` and `grep` stop at a fixed number of results and say so.
 * - A missing file, a binary file or an ambiguous edit is a sentence the model
 *   can act on, not an exception.
 */

import { glob as fsGlob, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, matchesGlob, relative } from "node:path";
import { z } from "zod";

import { displayPath, isInside, isOthersState, isSensitivePath, realPath, resolveUserPath, type StateScope } from "./paths.ts";
import type { ToolExecution, ToolHandler } from "./registry.ts";

export interface WorkspaceToolsOptions {
  workdir: string;
  homeDir?: string;
  /** The agent's own folders inside the runtime state. Defaults to the workdir. */
  ownRoots?: string[];
  /** Where every role's state lives (`JHT_API_HOME`). */
  stateRoots?: string[];
}

const MAX_READ_BYTES = 5_000_000;
const DEFAULT_READ_LINES = 2_000;
const MAX_GLOB_RESULTS = 500;
const MAX_GREP_MATCHES = 200;
const MAX_GREP_FILES = 5_000;
const MAX_GREP_FILE_BYTES = 1_000_000;
const SKIPPED_DIRS = new Set([".git", "node_modules", ".hg", ".svn", ".venv", "__pycache__"]);

export function createWorkspaceTools(options: WorkspaceToolsOptions): ToolHandler[] {
  const home = options.homeDir ?? homedir();
  // Symlinks resolved before anything is classified: the policy must judge the
  // file a call really touches, not the name it was given.
  const at = (input: string) => realPath(resolveUserPath(input, options.workdir, home));
  const show = (abs: string) => displayPath(abs, home);
  // What a walk from a parent folder must not descend into: the policy judges
  // the folder asked for, not every file below it.
  const scope: StateScope = {
    ownRoots: (options.ownRoots ?? [options.workdir]).map(realPath),
    stateRoots: (options.stateRoots ?? []).map(realPath),
  };
  const hidden = (abs: string) => isSensitivePath(abs) || isOthersState(abs, scope);
  // A folder on the way to the agent's own home is walked through, not into.
  const hiddenDir = (abs: string) => hidden(abs) && !scope.ownRoots.some((own) => isInside(abs, own));

  const readFileTool: ToolHandler = {
    spec: {
      name: "read_file",
      description:
        "Read a text file. Returns numbered lines. For long files pass offset (1-based line) " +
        `and limit (lines, default ${DEFAULT_READ_LINES}) to read a window.`,
      schema: z
        .object({
          path: z.string().min(1).max(1_000),
          offset: z.number().int().min(1).optional(),
          limit: z.number().int().min(1).max(5_000).optional(),
        })
        .strict(),
    },
    classify(args) {
      const { path } = args as { path: string };
      return { risk: "read", paths: [at(path)], summary: show(at(path)) };
    },
    async execute(args) {
      const { path, offset = 1, limit = DEFAULT_READ_LINES } = args as { path: string; offset?: number; limit?: number };
      const abs = at(path);
      const info = await statOrNull(abs);
      if (!info) return fail(`There is no file at ${show(abs)}.`);
      if (info.isDirectory()) return fail(`${show(abs)} is a folder. Use glob to list what is in it.`);
      if (info.size > MAX_READ_BYTES) return fail(`${show(abs)} is ${info.size} bytes, over the ${MAX_READ_BYTES}-byte limit.`);

      const buffer = await readFile(abs);
      if (buffer.subarray(0, 8_000).includes(0)) return fail(`${show(abs)} looks binary and was not read.`);
      const text = buffer.toString("utf8");
      if (text.length === 0) return ok(`${show(abs)} is empty.`);

      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      const from = offset - 1;
      const window = lines.slice(from, from + limit);
      if (window.length === 0) return fail(`${show(abs)} has ${lines.length} lines; offset ${offset} is past the end.`);

      const width = String(from + window.length).length;
      const body = window.map((line, i) => `${String(from + i + 1).padStart(width)}\t${line}`).join("\n");
      const last = from + window.length;
      const note = last < lines.length || from > 0 ? `\n[lines ${from + 1}–${last} of ${lines.length}]` : "";
      return ok(body + note);
    },
  };

  const writeFileTool: ToolHandler = {
    spec: {
      name: "write_file",
      description:
        "Create a file, or replace a file's entire content. Creates missing parent folders. " +
        "To change part of an existing file, use edit_file instead.",
      schema: z.object({ path: z.string().min(1).max(1_000), content: z.string() }).strict(),
    },
    classify(args) {
      const { path } = args as { path: string };
      return { risk: "write", paths: [at(path)], summary: show(at(path)) };
    },
    async execute(args) {
      const { path, content } = args as { path: string; content: string };
      const abs = at(path);
      const existed = (await statOrNull(abs)) !== null;
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      const bytes = Buffer.byteLength(content, "utf8");
      return ok(`${existed ? "Replaced" : "Created"} ${show(abs)} (${bytes} bytes).`);
    },
  };

  const editFileTool: ToolHandler = {
    spec: {
      name: "edit_file",
      description:
        "Replace an exact piece of text in a file. old_string must appear exactly once, " +
        "unless replace_all is true. Include enough surrounding text to make it unique. " +
        "Read the file first.",
      schema: z
        .object({
          path: z.string().min(1).max(1_000),
          old_string: z.string().min(1),
          new_string: z.string(),
          replace_all: z.boolean().optional(),
        })
        .strict(),
    },
    classify(args) {
      const { path } = args as { path: string };
      return { risk: "write", paths: [at(path)], summary: show(at(path)) };
    },
    async execute(args) {
      const { path, old_string, new_string, replace_all = false } = args as {
        path: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
      };
      const abs = at(path);
      if (old_string === new_string) return fail("old_string and new_string are identical; nothing to change.");
      const info = await statOrNull(abs);
      if (!info || info.isDirectory()) return fail(`There is no file at ${show(abs)}.`);

      const text = await readFile(abs, "utf8");
      const count = text.split(old_string).length - 1;
      if (count === 0) return fail(`old_string was not found in ${show(abs)}. Read the file and copy the text exactly.`);
      if (count > 1 && !replace_all) {
        return fail(`old_string appears ${count} times in ${show(abs)}. Add surrounding text to make it unique, or set replace_all.`);
      }

      // Slicing, not String.replace: `$&` and friends in new_string must stay literal.
      let next: string;
      if (replace_all) {
        next = text.split(old_string).join(new_string);
      } else {
        const at_ = text.indexOf(old_string);
        next = text.slice(0, at_) + new_string + text.slice(at_ + old_string.length);
      }
      await writeFile(abs, next, "utf8");
      return ok(`Replaced ${replace_all ? count : 1} occurrence${(replace_all ? count : 1) === 1 ? "" : "s"} in ${show(abs)}.`);
    },
  };

  const globTool: ToolHandler = {
    spec: {
      name: "glob",
      description:
        'Find files by name pattern, e.g. "**/*.md" or "*.yml". Searches the given folder ' +
        `(default: the working folder), skips .git and node_modules, returns at most ${MAX_GLOB_RESULTS} paths.`,
      schema: z.object({ pattern: z.string().min(1).max(500), path: z.string().min(1).max(1_000).optional() }).strict(),
    },
    classify(args) {
      const { pattern, path } = args as { pattern: string; path?: string };
      const base = at(path ?? ".");
      return { risk: "read", paths: [base], summary: `${pattern} in ${show(base)}` };
    },
    async execute(args) {
      const { pattern, path } = args as { pattern: string; path?: string };
      const base = at(path ?? ".");
      const info = await statOrNull(base);
      if (!info?.isDirectory()) return fail(`There is no folder at ${show(base)}.`);

      const found: string[] = [];
      let more = false;
      for await (const entry of fsGlob(pattern, { cwd: base })) {
        const name = String(entry);
        if (name.split(/[\\/]/).some((segment) => SKIPPED_DIRS.has(segment))) continue;
        if (hidden(join(base, name))) continue;
        if (found.length >= MAX_GLOB_RESULTS) {
          more = true;
          break;
        }
        found.push(name);
      }
      if (found.length === 0) return ok(`No files match ${pattern} in ${show(base)}.`);
      found.sort();
      const note = more ? `\n[stopped at ${MAX_GLOB_RESULTS} results; narrow the pattern]` : "";
      return ok(`In ${show(base)}:\n${found.join("\n")}${note}`);
    },
  };

  const grepTool: ToolHandler = {
    spec: {
      name: "grep",
      description:
        "Search file contents with a regular expression. Returns path:line:text for each match. " +
        'Optionally restrict to files matching a glob, e.g. "*.md". Skips binary files, credential files, .git and ' +
        `node_modules; stops at ${MAX_GREP_MATCHES} matches.`,
      schema: z
        .object({
          pattern: z.string().min(1).max(1_000),
          path: z.string().min(1).max(1_000).optional(),
          glob: z.string().min(1).max(200).optional(),
          ignore_case: z.boolean().optional(),
        })
        .strict(),
    },
    classify(args) {
      const { pattern, path } = args as { pattern: string; path?: string };
      const base = at(path ?? ".");
      return { risk: "read", paths: [base], summary: `/${pattern}/ in ${show(base)}` };
    },
    async execute(args) {
      const { pattern, path, glob, ignore_case } = args as {
        pattern: string;
        path?: string;
        glob?: string;
        ignore_case?: boolean;
      };
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, ignore_case ? "i" : "");
      } catch (error) {
        return fail(`Invalid regular expression: ${(error as Error).message}`);
      }

      const base = at(path ?? ".");
      const info = await statOrNull(base);
      if (!info) return fail(`There is nothing at ${show(base)}.`);

      const files = info.isDirectory() ? await walk(base, MAX_GREP_FILES, hidden, hiddenDir) : { paths: [base], truncated: false };
      const matches: string[] = [];
      for (const file of files.paths) {
        const rel = info.isDirectory() ? relative(base, file) : show(file);
        if (glob && !matchesGlob(rel, glob) && !matchesGlob(rel.split(/[\\/]/).pop() ?? rel, glob)) continue;
        const fileInfo = await statOrNull(file);
        if (!fileInfo || fileInfo.size > MAX_GREP_FILE_BYTES) continue;
        const buffer = await readFile(file);
        if (buffer.subarray(0, 8_000).includes(0)) continue;
        const lines = buffer.toString("utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i] ?? "")) {
            matches.push(`${rel}:${i + 1}:${(lines[i] ?? "").slice(0, 300)}`);
            if (matches.length >= MAX_GREP_MATCHES) break;
          }
        }
        if (matches.length >= MAX_GREP_MATCHES) break;
      }

      if (matches.length === 0) return ok(`No matches for /${pattern}/ in ${show(base)}.`);
      const notes: string[] = [];
      if (matches.length >= MAX_GREP_MATCHES) notes.push(`stopped at ${MAX_GREP_MATCHES} matches`);
      if (files.truncated) notes.push(`searched only the first ${MAX_GREP_FILES} files`);
      const note = notes.length > 0 ? `\n[${notes.join("; ")}; narrow the search]` : "";
      return ok(`In ${show(base)}:\n${matches.join("\n")}${note}`);
    },
  };

  return [readFileTool, writeFileTool, editFileTool, globTool, grepTool];
}

async function walk(
  root: string,
  limit: number,
  hidden: (path: string) => boolean,
  hiddenDir: (path: string) => boolean,
): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name) && !hiddenDir(path)) queue.push(path);
      } else if (entry.isFile() && !hidden(path)) {
        if (paths.length >= limit) return { paths, truncated: true };
        paths.push(path);
      }
    }
  }
  return { paths, truncated: false };
}

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function ok(content: string): ToolExecution {
  return { ok: true, content };
}

function fail(content: string): ToolExecution {
  return { ok: false, content };
}
