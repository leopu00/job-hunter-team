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

import { lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
        // Written beside it and renamed over it: a reader sees the flag whole or not at all.
        const tmp = join(options.profileDir, `.${FILES[flag]}.${process.pid}.tmp`);
        writeFileSync(tmp, flag === "ready" ? `${now().toISOString().replace(/\.\d{3}Z$/, "Z")}\n` : "", { flag: "wx", mode: 0o660 });
        renameSync(tmp, file);
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
