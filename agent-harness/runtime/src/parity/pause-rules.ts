import { readFileSync } from "node:fs";
import { join } from "node:path";
import { roleOf } from "../db/role-policy.ts";
import type { ToolHandler } from "../tools/registry.ts";

/**
 * When a pause is short instead of the one the run was given (`--pause-ms`,
 * the Capitano's in the TUI). The rule is written once, in
 * `agents/_skills/throttle/pause-rules.json`, and the TUI's throttle engine
 * (`shared/skills/throttle_engine.py`) reads the same file: the same unit of
 * work ends in the same pause, for the same reason, on both teams.
 *
 * `empty_unit`: a unit that inserted no position — a duplicate, or a lead the
 * filters discarded — was a check of seconds, not a unit of work. On a VPS the
 * SCOUT spent 660 s after each of them, one lead every 11 minutes. The next
 * pause is `short_pause_sec`, up to `max_streak` in a row; then the full pause
 * comes back, as the brake of a Scout on a dry list. The first pause of a run
 * has nothing to count from and is always the full one, as in the TUI after a
 * boot.
 *
 * `user_requests` (the ANALISTA with the user's requests waiting) is the TUI's
 * alone for now: here the database may be the hub's, and the queues are not
 * counted in this process.
 */
export interface PauseRules {
  shortPauseSec: number;
  emptyUnit: { roles: string[]; maxStreak: number };
}

export const PAUSE_RULES_FILE = join("agents", "_skills", "throttle", "pause-rules.json");

/** No file, or one that cannot be read: no rule, the full pause (the safe direction is the brake). */
export const NO_RULES: PauseRules = { shortPauseSec: 0, emptyUnit: { roles: [], maxStreak: 0 } };

export function loadPauseRules(appRoot: string): PauseRules {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(appRoot, PAUSE_RULES_FILE), "utf-8"));
  } catch {
    return NO_RULES;
  }
  const file = (raw ?? {}) as { short_pause_sec?: unknown; empty_unit?: { roles?: unknown; max_streak?: unknown } };
  const roles = Array.isArray(file.empty_unit?.roles) ? file.empty_unit.roles.filter((r): r is string => typeof r === "string") : [];
  return {
    shortPauseSec: Number.isInteger(file.short_pause_sec) ? (file.short_pause_sec as number) : 0,
    emptyUnit: { roles, maxStreak: Number.isInteger(file.empty_unit?.max_streak) ? (file.empty_unit!.max_streak as number) : 0 },
  };
}

/** What `db_insert position` answers when the row went in (db/tools.ts, as db_insert.py prints it). */
export const INSERTED = /^Position inserted with ID: \d+/m;

/** The positions this agent inserted since its last pause, counted from its own `db_insert` calls. */
export class WorkUnit {
  #inserted = 0;

  get inserted(): number {
    return this.#inserted;
  }

  noteInsert(): void {
    this.#inserted += 1;
  }

  /** A pause closes the unit. */
  close(): void {
    this.#inserted = 0;
  }
}

/**
 * `db_insert` as the role has it (local or the hub's), counting the rows it
 * really inserted. A duplicate refused by the UNIQUE index, a refused entity
 * or an error insert nothing.
 */
export function watchInserts(tool: ToolHandler, unit: WorkUnit): ToolHandler {
  if (tool.spec.name !== "db_insert") return tool;
  return {
    ...tool,
    async execute(args, context) {
      const result = await tool.execute(args, context);
      if (result.ok && INSERTED.test(result.content)) unit.noteInsert();
      return result;
    },
  };
}

export interface PauseDecision {
  ms: number;
  /** Set when a rule shortened the pause: what it would have been. */
  shortenedFromMs?: number;
  /** Short pauses in a row after empty units, this one included. */
  emptyStreak: number;
}

export class PausePolicy {
  #pauses = 0;
  #streak = 0;
  readonly #agent: string;
  readonly #rules: PauseRules;

  // Plain fields: the runtime runs on --experimental-strip-types, which has no parameter properties.
  constructor(agent: string, rules: PauseRules) {
    this.#agent = agent;
    this.#rules = rules;
  }

  /** The pause that ends `unit`, which it closes. */
  next(unit: WorkUnit, fullMs: number): PauseDecision {
    const first = this.#pauses === 0;
    this.#pauses += 1;
    const shortMs = this.#rules.shortPauseSec * 1000;
    const applies =
      !first &&
      this.#rules.emptyUnit.roles.includes(roleOf(this.#agent)) &&
      fullMs > shortMs &&
      this.#streak < this.#rules.emptyUnit.maxStreak &&
      unit.inserted === 0;
    unit.close();
    if (!applies) {
      this.#streak = 0;
      return { ms: fullMs, emptyStreak: 0 };
    }
    this.#streak += 1;
    return { ms: shortMs, shortenedFromMs: fullMs, emptyStreak: this.#streak };
  }
}
