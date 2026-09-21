/**
 * Who decides whether a tool call runs.
 *
 * Three modes:
 *
 * - `auto` (default): everything runs and nothing stops the loop. Agents are
 *   autonomous; a question at the keyboard is a stalled agent. What a role may
 *   not touch is refused outright, and the refusal tells the agent to request
 *   access from the captain instead of retrying.
 * - `ask`: reading inside the free folders just happens; writing, editing,
 *   running a command or reading anywhere else asks the person. "Always"
 *   remembers the answer for that tool until the session ends. Opt-in, for
 *   watching an agent step by step.
 * - `read-only`: nothing is written and nothing is run; reads outside the free
 *   folders and requests to the internet still ask.
 *
 * Files that commonly hold credentials (`.env`, SSH keys, cloud config) are
 * protected in every mode: `auto` refuses them, `ask` always asks and "always"
 * does not cover them. So is the runtime's own state (`~/.jht-api`) outside
 * the agent's own folders: another role's home, notes and traces are that
 * role's, and one agent does not read or change them. Read-only folders (the
 * person's profile) are read like any free folder and written in no mode: no
 * role changes what the person said about themselves.
 *
 * Paths arrive with symlinks already resolved (`realPath`), and the roots are
 * resolved the same way here, so both sides of every comparison are real.
 *
 * This is a gate, not a sandbox. A permitted shell command can do anything the
 * user can. The sandbox is the container of HHT ADR 0002; this is what makes the
 * agent usable on a bare machine until then.
 */

import { displayPath, isInside, isOthersState, isSensitivePath, realPath, type StateScope } from "../tools/paths.ts";
import type { ToolAccess, ToolRisk } from "../tools/registry.ts";

export type PermissionMode = "ask" | "auto" | "read-only";
export const PERMISSION_MODES: PermissionMode[] = ["ask", "auto", "read-only"];

export type PermissionAnswer = "allow" | "allow-always" | "deny";

export interface PermissionRequest {
  toolName: string;
  risk: ToolRisk;
  /** Why this call needs asking, in words: "runs a command", "changes a file". */
  reason: string;
  summary: string;
}

/** Asks the person. A transport supplies it; without one, anything that needs asking is denied. */
export type PermissionAsker = (request: PermissionRequest) => Promise<PermissionAnswer>;

export interface PermissionDecision {
  allowed: boolean;
  /** Whether the person was asked. False for free reads, `auto`, `read-only` and remembered answers. */
  asked: boolean;
  /** For a refusal: the sentence handed back to the model. */
  message?: string;
}

export class PermissionPolicy {
  readonly mode: PermissionMode;
  #freeReadRoots: string[];
  #readOnlyRoots: string[];
  #writable: string[];
  #scope: StateScope;
  #ask: PermissionAsker | undefined;
  #alwaysAllowed = new Set<string>();

  constructor(options: {
    mode: PermissionMode;
    freeReadRoots: string[];
    /**
     * The agent's own folders inside the runtime state: its home, its
     * workdir. Defaults to `freeReadRoots`.
     */
    ownRoots?: string[] | undefined;
    /**
     * Where the runtime keeps every role's state (`JHT_API_HOME`). Any folder
     * named `.jht-api` counts too, so a default install is covered without it.
     */
    stateRoots?: string[] | undefined;
    /** Folders no tool writes in, whatever the mode or the person's answer. */
    readOnlyRoots?: string[] | undefined;
    /**
     * The few paths inside a read-only root that this role does write (T38:
     * the ASSISTENTE's own files in the person's profile). Files or folders,
     * named one by one — never the root itself, or the root would not be one.
     */
    writable?: string[] | undefined;
    ask?: PermissionAsker | undefined;
  }) {
    this.mode = options.mode;
    this.#freeReadRoots = options.freeReadRoots.map(realPath);
    this.#readOnlyRoots = (options.readOnlyRoots ?? []).map(realPath);
    this.#writable = (options.writable ?? []).map(realPath);
    this.#scope = {
      ownRoots: (options.ownRoots ?? options.freeReadRoots).map(realPath),
      stateRoots: (options.stateRoots ?? []).map(realPath),
    };
    this.#ask = options.ask;
  }

  async decide(toolName: string, access: ToolAccess): Promise<PermissionDecision> {
    if (access.risk === "none") return { allowed: true, asked: false };
    if (access.risk === "write") {
      // T38: a read-only root may hold a few files this role does write — the
      // ASSISTENTE's profile inside the person's folder. The exception is a
      // list of PATHS, not the folder: everything else in there stays refused.
      const refused = access.paths.find(
        (p) => this.#readOnlyRoots.some((root) => isInside(root, p)) && !this.#writable.some((allowed) => isInside(allowed, p)),
      );
      if (refused !== undefined) return { allowed: false, asked: false, message: readOnly(refused) };
    }
    const sensitive = access.paths.some((p) => isSensitivePath(p) || isOthersState(p, this.#scope));
    const freeRead =
      !sensitive &&
      access.risk === "read" &&
      access.paths.every((p) => this.#freeReadRoots.some((root) => isInside(root, p)));
    if (freeRead) return { allowed: true, asked: false };
    if (this.mode === "auto") {
      return sensitive ? { allowed: false, asked: false, message: PROTECTED } : { allowed: true, asked: false };
    }

    if (this.mode === "read-only" && (access.risk === "write" || access.risk === "execute")) {
      return {
        allowed: false,
        asked: false,
        message: `Not allowed: this session is read-only, so nothing can be ${access.risk === "write" ? "written" : "run"}.`,
      };
    }
    if (this.#alwaysAllowed.has(toolName) && !sensitive) return { allowed: true, asked: false };
    if (!this.#ask) {
      return { allowed: false, asked: false, message: "Not allowed: this call needs the person's permission and nobody can be asked." };
    }

    const reason = sensitive ? "touches a file that may hold credentials" : REASON[access.risk];
    const answer = await this.#ask({ toolName, risk: access.risk, reason, summary: access.summary });
    if (answer === "allow-always") this.#alwaysAllowed.add(toolName);
    if (answer === "deny") {
      return {
        allowed: false,
        asked: true,
        message:
          "Permission denied: the person did not allow this call. Do not retry the same call; " +
          "ask them what they want, or find another way.",
      };
    }
    return { allowed: true, asked: true };
  }
}

/**
 * An autonomous agent never waits on a keyboard. Access it lacks goes through
 * the captain, who either does the work for it or grants the access.
 */
const PROTECTED =
  "Not allowed: this path is protected for your role. Do not retry it or work around it. " +
  "If you need it, request access from the captain: say which path and why, and either the " +
  "captain does it for you or grants you access. Carry on with what you can do meanwhile.";

/**
 * What a read-only root refuses, naming the file it refused. It used to say
 * "this is the person's profile" whatever the path was, which was true while
 * the profile and the person's own documents were read-only for every role.
 * Since T38 the ASSISTENTE writes the profile, and its read-only root is the
 * history: a fixed sentence would have named the wrong file to the one role
 * that can tell the difference.
 */
function readOnly(path: string): string {
  return (
    `Not allowed: ${displayPath(path)} is the person's own. Read it, never change it. ` +
    "If something in it looks wrong or out of date, say so to the person or to the captain instead."
  );
}

const REASON: Record<ToolRisk, string> = {
  none: "",
  read: "reads outside the working folders",
  network: "reaches the internet",
  write: "changes a file",
  execute: "runs a command",
};
