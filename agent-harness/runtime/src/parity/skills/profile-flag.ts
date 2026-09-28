/**
 * The ASSISTENTE's two flags in the person's profile folder, as a tool.
 *
 * `ready.flag` is the "Vai alla dashboard" button (profile-yaml: create it,
 * check it with `test -f`, remove it with `rm -f` when a field turns out
 * wrong); `welcomed.flag` is the Telegram welcome handshake (assistente.md).
 * The TUI does all of it in the shell. Here the shell runs in the kernel
 * sandbox, which lets it write the role's own home and nothing of the
 * person's: from bash the flag can no longer be set, checked is all it can do,
 * and removing it — the step that puts the button back on hold — has no other
 * tool at all (write_file writes, nothing deletes).
 *
 * So the flags get a tool of their own, as narrow as the job: two file names,
 * three actions, in the one folder. It does not open the profile to the shell,
 * and it is not a file tool with a nice name: no path is the caller's.
 */

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { ToolHandler } from "../../tools/registry.ts";

export const PROFILE_FLAG_TOOL = "profile_flag";

/**
 * The ASSISTENTE's parity note. The skill's shell lines stay as the TUI needs
 * them; the difference goes where every other difference of this harness goes,
 * the notes the role reads each round.
 */
export const PROFILE_FLAG_NOTE =
  "Your flags in the person's profile folder, ready.flag and welcomed.flag, are the `profile_flag` tool here: " +
  "`set` for `date -u … > ready.flag` and `touch welcomed.flag`, `check` for `test -f`, `clear` for `rm -f`. " +
  "Your shell cannot write the person's profile, so those lines would fail; FLAG_OK and FLAG_MISSING mean what " +
  "your skill says they mean.";

/** The flags and their files: the names the product's frontend and bridge read. */
const FILES = { ready: "ready.flag", welcomed: "welcomed.flag" } as const;

type Flag = keyof typeof FILES;
type Action = "set" | "clear" | "check";

const ARGS = z
  .object({
    flag: z.enum(["ready", "welcomed"]),
    action: z.enum(["set", "clear", "check"]),
  })
  .strict();

export interface ProfileFlagToolOptions {
  /** The person's profile folder. Absolute. */
  profileDir: string;
  /** The flag's content on `set`: the TUI writes `date -u +%Y-%m-%dT%H:%M:%SZ` into ready.flag. */
  now?: () => Date;
}

export function createProfileFlagTool(options: ProfileFlagToolOptions): ToolHandler {
  const now = options.now ?? (() => new Date());
  const fileOf = (flag: Flag) => join(options.profileDir, FILES[flag]);

  return {
    spec: {
      name: PROFILE_FLAG_TOOL,
      description:
        "Set, clear or check one of your two flags in the person's profile folder: `ready` (ready.flag, the " +
        "'Vai alla dashboard' button) or `welcomed` (welcomed.flag, the welcome already sent). This is what your " +
        "instructions do with `date -u … > ready.flag`, `touch welcomed.flag`, `test -f` and `rm -f`: here the shell " +
        "cannot write the person's profile. It answers FLAG_OK when the flag is there, FLAG_MISSING when it is not.",
      schema: ARGS,
    },

    classify(args) {
      const { flag, action } = args as { flag: Flag; action: Action };
      return { risk: action === "check" ? "read" : "write", paths: [fileOf(flag)], summary: `${action} ${FILES[flag]}` };
    },

    async execute(args) {
      const { flag, action } = args as { flag: Flag; action: Action };
      const file = fileOf(flag);
      const kind = kindOf(file);
      // Only a plain file is a flag. A link is not followed and not replaced: whoever
      // put it there meant it to point somewhere, and that is not the flag's business.
      if (kind !== "file" && kind !== "none") {
        return { ok: false, content: `Error: ${FILES[flag]} in the profile folder is a ${kind}, not a flag. Nothing was changed; tell the person or the team.` };
      }
      if (action === "set") {
        mkdirSync(options.profileDir, { recursive: true });
        removeStaleTemps(options.profileDir, FILES[flag]);
        const content = flag === "ready" ? `${now().toISOString().replace(/\.\d{3}Z$/, "Z")}\n` : "";
        // Written beside it and renamed over it: a reader sees the flag whole or not at all.
        // The random part keeps a leftover from a failed write from ever owning the name:
        // the pid alone is the same after every restart of the container.
        const tmp = join(options.profileDir, `.${FILES[flag]}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
        let written = false;
        try {
          writeFileSync(tmp, content, { flag: "wx", mode: 0o660 });
          written = true;
          renameSync(tmp, file);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          // No leftover (a half-written one after ENOSPC included). EEXIST on the write
          // means the name was someone else's: that file is not ours to remove. If the
          // removal fails too, the next `set` takes it once it is stale.
          if (written || code !== "EEXIST") {
            try {
              unlinkSync(tmp);
            } catch {
              // ENOENT: it was never created.
            }
          }
          const reason = code ?? (error instanceof Error ? error.message : String(error));
          return { ok: false, content: `Error: ${FILES[flag]} could not be written in the profile folder (${reason}). ${kindOf(file) === "file" ? "FLAG_OK" : "FLAG_MISSING"} ${FILES[flag]}; tell the person or the team.` };
        }
      } else if (action === "clear" && kind === "file") {
        unlinkSync(file);
      }
      // The answer is read back from the disk, never assumed: the skill's step 2
      // exists because a flag "written" is not a flag that is there.
      const there = kindOf(file) === "file";
      const state = there ? "FLAG_OK" : "FLAG_MISSING";
      const verdict = action === "set" && !there ? " — it was not created" : action === "clear" && there ? " — it is still there" : "";
      return { ok: verdict === "", content: `${state} ${FILES[flag]}${verdict}` };
    },
  };
}

/**
 * Temp files a failed `set` left behind: `.<flag file>.<anything>.tmp`, plain
 * files only (lstat, so a link is neither followed nor removed, and a directory
 * is left alone), and only once they are a minute old. A `set` of this process
 * writes and renames in one synchronous step, so a younger one can only be
 * another process's write in flight; a leftover is never that young for long.
 * Nothing else in the folder is looked at. Best effort: a leftover that cannot
 * be removed does not stop the flag, since the new temp name never collides.
 */
function removeStaleTemps(dir: string, name: string): void {
  const prefix = `.${name}.`;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_TEMP_MS;
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".tmp") || entry.length <= prefix.length + ".tmp".length) continue;
    const path = join(dir, entry);
    try {
      const stat = lstatSync(path);
      if (stat.isFile() && stat.mtimeMs < cutoff) unlinkSync(path);
    } catch {
      // Gone already, or not ours to remove: either way not in the way of the flag.
    }
  }
}

const STALE_TEMP_MS = 60_000;

function kindOf(path: string): "none" | "file" | "directory" | "symbolic link" | "special file" {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return "symbolic link";
    if (stat.isDirectory()) return "directory";
    return stat.isFile() ? "file" : "special file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "none";
    throw error;
  }
}
