/**
 * The CAPITANO's launcher, the deciding half (SICUREZZA §9, T22).
 *
 * The CAPITANO asks, the launcher decides. Every limit is here, in the hub,
 * set by the operator in a file the CAPITANO cannot touch: a CAPITANO that
 * read an injected message stays inside them however much it "wants" out.
 * The prompt may repeat them; nothing relies on it.
 *
 * An accepted spawn becomes an order in the spool (`requests/<id>.json`);
 * the host's executor, the only side that can start a container, runs it and
 * writes back `results/<id>.json` with what the key proxy says it spent. The
 * piggy bank books a spawn's cap when it is accepted and keeps the measured
 * spend when it ends: what the child did not spend comes back.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { roleOf } from "../db/role-policy.ts";

const ROLE = /^[a-z][a-z0-9]{0,31}$/;

export const LauncherConfigSchema = z
  .object({
    /** Changing it starts a new session: counts and the piggy bank start over. */
    session: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    /** The session's piggy bank, the CAPITANO's own cap included. */
    sessionUsd: z.number().positive().max(10),
    captainUsd: z.number().nonnegative(),
    /** The allowlist: role → its cap per child and its instances at once. */
    roles: z.record(z.string().regex(ROLE), z.object({ capUsd: z.number().positive().max(5), instances: z.number().int().min(1).max(4) }).strict()),
    maxActive: z.number().int().min(1).max(8),
    maxSpawns: z.number().int().min(1).max(50),
    /** A role that failed this many times in the session is not started again. */
    maxFailures: z.number().int().min(1).max(10),
    maxMinutes: z.number().int().min(1).max(240),
    models: z.array(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)).min(1),
    taskChars: z.number().int().min(1).max(8_000),
    /**
     * The base set `run-team` starts, in this order, as the product's
     * launcher starts it. A member is a peer, not a child: it does not spend
     * the CAPITANO's spawns, and it outlives it.
     */
    team: z
      .array(
        z
          .object({
            role: z.string().regex(ROLE),
            instances: z.number().int().min(1).max(4).default(1),
            cap_usd: z.number().positive().max(5).optional(),
            model: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
            task: z.string().optional(),
            /** Seconds the executor waits before this member, as the product staggers its boot. */
            delay_s: z.number().int().min(0).max(600).optional(),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    /**
     * Money kept aside for the CAPITANO's own spawns: `run-team` refuses to
     * take the session below it, so a base set cannot fill the piggy bank and
     * leave the CAPITANO unable to start anyone.
     */
    spawnReserveUsd: z.number().nonnegative().default(0),
  })
  .strict()
  .refine((c) => !Object.hasOwn(c.roles, "capitano"), { message: "capitano is never in the allowlist" });
export type LauncherConfig = z.infer<typeof LauncherConfigSchema>;

export const SpawnRequest = z
  .object({
    role: z.string().max(32),
    instance: z.number().int().min(1).max(9).optional(),
    cap_usd: z.number(),
    model: z.string().max(64),
    task: z.string(),
  })
  .strict();

export const StopRequest = z.object({ spawn_id: z.string().regex(/^[0-9a-f]{16}$/) }).strict();

type SpawnState = "queued" | "running" | "done" | "failed" | "stopped";

export type SpawnKind = "team" | "spawn";

export interface Spawn {
  id: string;
  /** `team`: a member of the base set, a peer. `spawn`: a child of the CAPITANO. */
  kind: SpawnKind;
  agent: string;
  role: string;
  model: string;
  capUsd: number;
  requestedBy: string;
  at: number;
  state: SpawnState;
  spentUsd?: number;
  exitCode?: number;
}

interface State {
  session: string;
  spawns: Spawn[];
}

class LauncherStateError extends Error {}

/** `state.json` as the launcher writes it: anything else is not its state. */
const StateSchema = z.object({
  session: z.string(),
  spawns: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["team", "spawn"]),
      agent: z.string(),
      role: z.string(),
      model: z.string(),
      capUsd: z.number(),
      requestedBy: z.string(),
      at: z.number(),
      state: z.enum(["queued", "running", "done", "failed", "stopped"]),
      spentUsd: z.number().optional(),
      exitCode: z.number().optional(),
    }),
  ),
});

/** What the host's executor writes back. */
const Result = z
  .object({
    spawn_id: z.string(),
    state: z.enum(["running", "done", "failed", "stopped"]),
    exit_code: z.number().int().optional(),
    spent_usd: z.number().nonnegative().optional(),
  })
  .strict();

export interface LauncherOptions {
  config: LauncherConfig;
  /** The hub's own folder: `state.json` and `launcher.log`. */
  stateDir: string;
  /** Shared with the host's executor: `requests/`, `results/`, `stops/`. */
  spoolDir: string;
  /** The operator's emergency switch: while it exists, nothing starts. */
  stopFile?: string;
  now?: () => number;
}

export type SpawnAnswer =
  | { ok: true; spawn_id: string; agent: string; booked_usd: number; left_usd: number }
  | { ok: false; reason: string };

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

export class Launcher {
  readonly #config: LauncherConfig;
  readonly #stateFile: string;
  readonly #log: string;
  readonly #spool: string;
  readonly #stopFile: string | undefined;
  readonly #now: () => number;

  constructor(options: LauncherOptions) {
    this.#config = options.config;
    mkdirSync(options.stateDir, { recursive: true });
    this.#stateFile = join(options.stateDir, "state.json");
    this.#log = join(options.stateDir, "launcher.log");
    this.#spool = options.spoolDir;
    for (const dir of ["requests", "results", "stops"]) mkdirSync(join(this.#spool, dir), { recursive: true });
    this.#stopFile = options.stopFile;
    this.#now = options.now ?? Date.now;
  }

  /** Only a CAPITANO spawns; a child never does, so the tree is one level deep. */
  static mayLaunch(agent: string): boolean {
    return roleOf(agent) === "capitano";
  }

  /** The CAPITANO's own child: `spawn`, counted against its limits. */
  spawn(by: string, request: z.infer<typeof SpawnRequest>): SpawnAnswer {
    const refuse = (reason: string): SpawnAnswer => {
      this.#write({ event: "refused", by, role: request.role, instance: request.instance, cap_usd: request.cap_usd, model: request.model, task: headline(request.task), reason });
      return { ok: false, reason };
    };
    const state = this.#readable(refuse);
    if (!("spawns" in state)) return state;
    const answer = this.#start(state, "spawn", by, request);
    if (!answer.ok) return refuse(answer.reason);
    this.#save(state);
    return answer;
  }

  /**
   * The base set, in the configured order, as the product's launcher starts
   * it (T24): one call, one booking of the whole set, and the members are
   * peers — they do not spend the CAPITANO's spawns and they outlive it.
   */
  startTeam(by: string): { ok: boolean; reason?: string; started: SpawnAnswer[]; left_usd?: number; note?: string } {
    const c = this.#config;
    const refuse = (reason: string) => {
      this.#write({ event: "team_refused", by, reason });
      return { ok: false, reason, started: [] };
    };
    if (!c.team || c.team.length === 0) return refuse("This launcher has no team in its configuration.");
    const state = this.#readable((reason) => ({ ok: false, reason, started: [] as SpawnAnswer[] }));
    if (!("spawns" in state)) return state;
    if (this.#stopped()) return refuse("The operator's STOP is on: nothing starts.");
    const running = state.spawns.filter((s) => s.kind === "team" && (s.state === "queued" || s.state === "running"));
    if (running.length > 0) {
      return refuse(`The team of this session is already up: ${running.map((s) => s.agent).join(", ")}. Stop it before starting it again.`);
    }

    const started: SpawnAnswer[] = [];
    for (const member of c.team) {
      for (let i = 0; i < member.instances; i++) {
        const answer = this.#start(state, "team", by, {
          role: member.role,
          cap_usd: member.cap_usd ?? (member.role === "capitano" ? c.captainUsd : (c.roles[member.role]?.capUsd ?? 0)),
          model: member.model ?? c.models[0] ?? "",
          task: member.task ?? "Start your cycle.",
          ...(member.delay_s === undefined ? {} : { delay_s: member.delay_s }),
        });
        started.push(answer);
      }
    }
    this.#save(state);
    const up = started.filter((a) => a.ok).length;
    this.#write({ event: "team_started", by, members: up, refused: started.length - up });
    // The MASTER asked for a live run where the CAPITANO can still spawn one
    // extra: say plainly when the set leaves it no room.
    const left = round(c.sessionUsd - this.#used(state));
    const free = Object.entries(c.roles).some(([role, r]) => {
      const busy = state.spawns.filter((s) => s.role === role && (s.state === "queued" || s.state === "running")).length;
      return busy < r.instances && left >= r.capUsd;
    });
    return {
      ok: up > 0,
      started,
      left_usd: left,
      ...(free ? {} : { note: "No room left for an extra spawn: every allowed role is at its instances, or the money left is below its cap." }),
      ...(up === 0 ? { reason: "No member of the team could start." } : {}),
    };
  }

  /**
   * One member or one child, checked and written. The caller saves the state:
   * a team start books its whole set against the same piggy bank, in order.
   */
  #start(
    state: State,
    kind: SpawnKind,
    by: string,
    request: { role: string; instance?: number | undefined; cap_usd: number; model: string; task: string; delay_s?: number | undefined },
  ): SpawnAnswer {
    const c = this.#config;
    const refuse = (reason: string): SpawnAnswer => ({ ok: false, reason });
    if (this.#stopped()) return refuse("The operator's STOP is on: nothing starts.");
    // The CAPITANO is a member of the team like the others, and never a child
    // of anyone: no recursion, no second captain.
    const captain = kind === "team" && request.role === "capitano";
    const allowed = captain ? { capUsd: c.captainUsd, instances: 1 } : Object.hasOwn(c.roles, request.role) ? c.roles[request.role] : undefined;
    if (!allowed) return refuse(`${request.role || "(none)"} is not a role the launcher starts. Allowed: ${Object.keys(c.roles).join(", ")}.`);
    if (!c.models.includes(request.model)) return refuse(`${request.model} is not an allowed model. Allowed: ${c.models.join(", ")}.`);
    if (!(request.cap_usd > 0) || request.cap_usd > allowed.capUsd) {
      return refuse(`cap_usd ${request.cap_usd} is outside (0, ${allowed.capUsd}] for ${request.role}. Ask again within it: it is not lowered for you.`);
    }
    if (request.task.length > c.taskChars) return refuse(`The task is ${request.task.length} characters; the limit is ${c.taskChars}.`);
    if (request.instance !== undefined && request.instance > allowed.instances) {
      return refuse(`${request.role} runs at most ${allowed.instances} instance(s).`);
    }

    const active = state.spawns.filter((s) => s.state === "queued" || s.state === "running");
    // A member of the team is a peer: it does not spend the CAPITANO's spawns.
    if (kind === "spawn") {
      const children = active.filter((s) => s.kind === "spawn");
      if (children.length >= c.maxActive) return refuse(`${children.length} children are running, the most at once is ${c.maxActive}. Wait for one to end.`);
      if (state.spawns.filter((s) => s.kind === "spawn").length >= c.maxSpawns) return refuse(`This session has used its ${c.maxSpawns} spawns.`);
      const failures = state.spawns.filter((s) => s.kind === "spawn" && s.role === request.role && s.state === "failed").length;
      if (failures >= c.maxFailures) return refuse(`${request.role} failed ${failures} times in this session and is not started again.`);
    }
    // An instance runs once, whoever started it: a child never doubles a member.
    const busy = new Set(active.map((s) => s.agent));
    const instances = request.instance !== undefined ? [request.instance] : Array.from({ length: allowed.instances }, (_, i) => i + 1);
    const instance = instances.find((i) => !busy.has(`${request.role}-${i}`));
    if (instance === undefined) {
      return refuse(`${request.role} is already running ${request.instance !== undefined ? `as ${request.role}-${request.instance}` : `in all its ${allowed.instances} instance(s)`}.`);
    }

    const used = this.#used(state);
    // The team leaves the CAPITANO its reserve; a child may spend it. The
    // CAPITANO's own order costs nothing more: its cap is already reserved.
    const reserve = kind === "team" ? c.spawnReserveUsd : 0;
    const charge = captain ? 0 : request.cap_usd;
    if (used + charge + reserve > c.sessionUsd + 1e-9) {
      const left = round(c.sessionUsd - used);
      return refuse(
        reserve > 0
          ? `cap_usd ${request.cap_usd} does not fit with ${reserve} USD kept for the CAPITANO's spawns: ${left} USD of the session's ${c.sessionUsd} is left.`
          : `cap_usd ${request.cap_usd} does not fit: ${left} USD of the session's ${c.sessionUsd} is left.`,
      );
    }

    const spawn: Spawn = {
      id: randomBytes(8).toString("hex"),
      kind,
      agent: `${request.role}-${instance}`,
      role: request.role,
      model: request.model,
      capUsd: request.cap_usd,
      requestedBy: by,
      at: this.#now(),
      state: "queued",
    };
    state.spawns.push(spawn);
    // The order the executor runs: every field the launcher's, the task as data.
    atomicWrite(
      join(this.#spool, "requests", `${spawn.id}.json`),
      JSON.stringify({
        spawn_id: spawn.id,
        session: c.session,
        kind,
        role: spawn.role,
        agent: spawn.agent,
        model: spawn.model,
        cap_usd: spawn.capUsd,
        max_minutes: c.maxMinutes,
        ...(request.delay_s === undefined ? {} : { delay_s: request.delay_s }),
        task: request.task,
      }),
    );
    this.#write({ event: kind === "team" ? "team_member" : "spawned", by, spawn_id: spawn.id, agent: spawn.agent, cap_usd: spawn.capUsd, model: spawn.model, task: headline(request.task) });
    return { ok: true, spawn_id: spawn.id, agent: spawn.agent, booked_usd: spawn.capUsd, left_usd: round(c.sessionUsd - used - charge) };
  }

  /** A CAPITANO stops only the children it started. */
  stop(by: string, spawnId: string): { ok: boolean; reason?: string } {
    const state = this.#readable((reason) => {
      this.#write({ event: "stop_refused", by, spawn_id: spawnId, reason });
      return { ok: false, reason };
    });
    if (!("spawns" in state)) return state;
    const spawn = state.spawns.find((s) => s.id === spawnId && s.requestedBy === by && s.kind === "spawn");
    if (!spawn) return { ok: false, reason: "No child of yours has that spawn_id. A member of the base team is not yours to stop: ask the operator." };
    if (spawn.state !== "queued" && spawn.state !== "running") return { ok: false, reason: `That child has already ended (${spawn.state}).` };
    atomicWrite(join(this.#spool, "stops", spawnId), "");
    this.#write({ event: "stop_requested", by, spawn_id: spawnId, agent: spawn.agent });
    return { ok: true };
  }

  list(by: string): { session: string; left_usd: number; spawns: Array<Omit<Spawn, "requestedBy">> } | { ok: false; reason: string } {
    const state = this.#readable((reason) => ({ ok: false as const, reason }));
    if (!("spawns" in state)) return state;
    return {
      session: state.session,
      left_usd: round(this.#config.sessionUsd - this.#used(state)),
      spawns: state.spawns.filter((s) => s.requestedBy === by).map(({ requestedBy: _by, ...rest }) => rest),
    };
  }

  /** The state, or `refuse`'s answer, logged, when it cannot be read. */
  #readable<T>(refuse: (reason: string) => T): State | T {
    try {
      return this.#refresh();
    } catch (error) {
      if (!(error instanceof LauncherStateError)) throw error;
      const reason = `The launcher's state ${error.message}: nothing starts or stops through it until the operator checks it. The operator's STOP still works.`;
      this.#write({ event: "state_unreadable", detail: error.message });
      return refuse(reason);
    }
  }

  /** The CAPITANO's own cap, the children still running at their caps, the ended ones at what they spent. */
  #used(state: State): number {
    // The CAPITANO's cap is reserved from the first moment of the session and
    // counted once: its own order spends that reserve, it does not add to it,
    // so the money left does not jump when the team reaches the CAPITANO.
    return (
      this.#config.captainUsd +
      state.spawns
        .filter((s) => s.role !== "capitano")
        .reduce((sum, s) => sum + (s.state === "queued" || s.state === "running" ? s.capUsd : (s.spentUsd ?? s.capUsd)), 0)
    );
  }

  #stopped(): boolean {
    return this.#stopFile !== undefined && existsSync(this.#stopFile);
  }

  /**
   * The state, with what the executor reported since. No file is a fresh
   * start; a file that cannot be read is not (L-1): starting over would empty
   * the piggy bank and every count in silence, so it throws and nothing
   * starts until the operator looks.
   */
  #refresh(): State {
    let state: State = { session: this.#config.session, spawns: [] };
    let text: string | undefined;
    try {
      text = readFileSync(this.#stateFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new LauncherStateError(`cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"})`);
    }
    if (text !== undefined) {
      let saved: State;
      try {
        saved = StateSchema.parse(JSON.parse(text)) as State;
      } catch {
        throw new LauncherStateError("is not a launcher state");
      }
      // Another session's state is the past: this session starts over.
      if (saved.session === this.#config.session) state = saved;
    }
    let changed = false;
    const results = new Set(safeList(join(this.#spool, "results")));
    for (const spawn of state.spawns) {
      if (spawn.state !== "queued" && spawn.state !== "running") continue;
      if (!results.has(`${spawn.id}.json`)) continue;
      let parsed: z.infer<typeof Result>;
      try {
        parsed = Result.parse(JSON.parse(readFileSync(join(this.#spool, "results", `${spawn.id}.json`), "utf8")));
      } catch {
        continue;
      }
      if (parsed.spawn_id !== spawn.id || parsed.state === spawn.state) continue;
      spawn.state = parsed.state;
      if (parsed.exit_code !== undefined) spawn.exitCode = parsed.exit_code;
      if (parsed.spent_usd !== undefined) spawn.spentUsd = parsed.spent_usd;
      changed = true;
      if (parsed.state !== "running") this.#write({ event: "ended", spawn_id: spawn.id, agent: spawn.agent, state: parsed.state, exit_code: parsed.exit_code, spent_usd: parsed.spent_usd });
    }
    if (changed) this.#save(state);
    return state;
  }

  #save(state: State): void {
    atomicWrite(this.#stateFile, JSON.stringify(state));
  }

  #write(entry: Record<string, unknown>): void {
    appendFileSync(this.#log, `${JSON.stringify({ at: new Date(this.#now()).toISOString(), ...entry })}\n`, "utf8");
  }
}

/** The first 200 characters of a task, on one line, for the log. */
function headline(task: string): string {
  return task.replace(/\s+/g, " ").trim().slice(0, 200);
}

function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o640 });
  renameSync(tmp, file);
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
