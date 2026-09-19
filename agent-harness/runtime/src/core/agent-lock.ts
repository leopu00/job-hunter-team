/**
 * One process per agent.
 *
 * `start-agent.sh scout` with no instance starts SCOUT-1, and `scout_coord`
 * gives a Scout started as `scout` the id scout-1: two runs, one as `scout`
 * and one as `scout-1`, would both write as scout-1 — the same claims, the
 * same split — and neither would know (SICUREZZA P2). Two runs under the same
 * name would also share a home and a mailbox. So a run takes a lock on its
 * agent's canonical id before anything else, and a second run is refused.
 *
 * Not `api-worker/src/run-lock.ts`: that one imports a module by a path the
 * harness cannot load as it runs TypeScript directly, and it has no way back
 * from a lock left by a process that died — a `podman stop` past its timeout
 * would block every later start until someone removed the file by hand. Here
 * the lock names its process, and a lock whose process is gone is taken over —
 * under a takeover guard, so two starts after a crash cannot both take it.
 * The lock lives under the runtime's state, which no agent's file tools reach.
 *
 * Liveness is a pid, so the lock holds among runs that share a pid namespace:
 * one host, or one container. Two containers mounting the same `apiHome`
 * would each see the other's pid as gone; run the team's agents in one.
 */

import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

import { HarnessError } from "./errors.ts";

/** A lock file this young with no readable content is being written, not abandoned. */
const WRITING_GRACE_MS = 5_000;

interface Holder {
  pid: number;
  runId: string;
  agent: string;
  startedAt: string;
}

/**
 * The agent's canonical id: lowercase, and a bare name as instance 1
 * (`scout` → `scout-1`), as `start-agent.sh` numbers a role started without
 * an instance.
 */
export function agentInstanceId(agent: string): string {
  const name = agent.trim().toLowerCase();
  return /-\d+$/.test(name) ? name : `${name}-1`;
}

export class AgentLock {
  readonly path: string;
  #holder: Holder;
  #released = false;

  private constructor(path: string, holder: Holder) {
    this.path = path;
    this.#holder = holder;
  }

  /** Takes the lock for `agent` under `dir`, or throws `agent_running` naming who holds it. */
  static acquire(options: {
    dir: string;
    agent: string;
    runId: string;
    pid?: number;
    now?: () => Date;
    /**
     * Test seam: runs after this start judged the lock stale and before it
     * takes it over — the window a second start could use. Never set in production.
     */
    beforeTakeover?: () => void;
  }): AgentLock {
    const id = agentInstanceId(options.agent);
    const path = join(options.dir, `${id}.lock`);
    const holder: Holder = {
      pid: options.pid ?? process.pid,
      runId: options.runId,
      agent: options.agent,
      startedAt: (options.now ?? (() => new Date()))().toISOString(),
    };
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
    const refuse = (current: Holder | "writing") => {
      const who =
        current === "writing" ? "another run that is starting" : `pid ${current.pid}, started as '${current.agent}' at ${current.startedAt}`;
      return new HarnessError(
        "agent_running",
        `${id} is already running (${who}). ` +
          `'${options.agent}' would act as ${id} too: two runs would write the same claims and the same split. ` +
          "Stop the other run, or start this one under another instance name.",
      );
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      if (create(path, holder)) return new AgentLock(path, holder);
      const current = readHolder(path);
      if (current === "writing" || (current !== null && isAlive(current.pid))) throw refuse(current);
      options.beforeTakeover?.();
      // The lock's process is gone. Removing it is read-then-unlink, and two
      // starts doing that at once could each remove the other's new lock and
      // both run. So only the holder of the takeover guard may remove it, and
      // only after reading, under the guard, that it is still the same dead lock.
      const taken = underGuard(`${path}.takeover`, () => {
        const again = readHolder(path);
        if (again === "writing" || (again !== null && isAlive(again.pid))) throw refuse(again);
        if (again !== null && current !== null && (again.pid !== current.pid || again.runId !== current.runId)) return false;
        removeIfPresent(path);
        return create(path, holder);
      });
      if (taken === true) return new AgentLock(path, holder);
      // Guard busy, or the lock changed hands: look again from the start.
    }
    throw new HarnessError("agent_running", `${id} is being started by another run at the same moment.`);
  }

  /** Removes the lock if it is still this run's. Safe to call more than once. */
  release(): void {
    if (this.#released) return;
    this.#released = true;
    const current = readHolder(this.path);
    // A lock taken over after this run was believed dead is not ours to remove.
    if (current === null || current === "writing" || current.runId !== this.#holder.runId || current.pid !== this.#holder.pid) return;
    try {
      unlinkSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** Creates the lock file only if there is none. False when one exists. */
function create(path: string, holder: Holder): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeSync(fd, `${JSON.stringify(holder)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Runs `work` holding the guard file, created exclusively. Returns undefined
 * when another start holds it. A guard older than the grace period was left
 * by a start that died mid-takeover, and is removed.
 */
function underGuard<T>(guard: string, work: () => T): T | undefined {
  let fd: number;
  try {
    fd = openSync(guard, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (ageMs(guard) >= WRITING_GRACE_MS) removeIfPresent(guard);
    return undefined;
  }
  closeSync(fd);
  try {
    return work();
  } finally {
    removeIfPresent(guard);
  }
}

function ageMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** The lock's holder; "writing" for a fresh file with nothing readable yet; null when there is no lock or it is abandoned. */
function readHolder(path: string): Holder | "writing" | null {
  let raw: string;
  let ageMs: number;
  try {
    raw = readFileSync(path, "utf8");
    ageMs = Date.now() - statSync(path).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const holder = JSON.parse(raw) as Partial<Holder>;
    if (typeof holder.pid === "number" && Number.isInteger(holder.pid) && holder.pid > 0) return holder as Holder;
  } catch {
    // unreadable: decided by age below
  }
  return ageMs < WRITING_GRACE_MS ? "writing" : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it is just not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
