import { invoke } from "@tauri-apps/api/core";

/**
 * How the team's weekly budget is going, read through the native `team_budget_read` command (the numbers the team computes with
 * the same rate, active-hours line and verdict as the Sentinella and the pace guard). Read only. The closed lists below are all
 * the page ever gets: numbers in their range, timestamps, and CODES from a closed list that the page puts in words. A reply that
 * carries anything else, or a value off its range, is `budget_unavailable` and never a number made up or a word the team chose.
 * A number the team does not have is `null`, which is not 0.
 */

export type BudgetLine = "ahead" | "on" | "behind";
export type BudgetVerdictCode = "ahead" | "lockout_risk" | "on_pace" | "behind" | "no_data";
export type BudgetBrake = "pace_ahead" | "lockout_risk" | "daily_cap_stop" | "recovering_after_freeze" | "pause_between_jobs";
export type BurnState = "off" | "active" | "expired" | "unknown";
export type BudgetRole =
  | "capitano" | "sentinella" | "assistente" | "mentor" | "dottore" | "mantenitore" | "scout" | "analista" | "scorer"
  | "scrittore" | "critico" | "tesoriere" | "closer";

export interface BudgetWeek {
  usedPct: number | null;
  remainingPct: number | null;
  /** Unix seconds of the reset. */
  resetAtUnix: number | null;
  /** Hours the team will work between now and the reset. */
  activeHoursToReset: number | null;
  /** Where the team should be on the active-hours line. */
  idealUsedPct: number | null;
  /** Points above (+) or below (-) that line. */
  deviationPts: number | null;
  line: BudgetLine | null;
}

export interface BudgetRate {
  loPctH: number | null;
  hiPctH: number | null;
  nowPctH: number | null;
  sustainablePctH: number | null;
  projectedFinalPct: number | null;
  wastedPct: number | null;
  /** Active hours before the reset at which the budget would run out at the slowest recent rate. */
  lockoutEarlyActiveH: number | null;
  marginActiveH: number | null;
}

export interface BudgetBurn {
  state: BurnState;
  grantedAt: string | null;
  expiresAt: string | null;
  remainingMin: number | null;
  /** Points of the week spent since it was granted; `null` when the grant is out of the readings the team holds. */
  spentPts: number | null;
  paceBeforePctH: number | null;
  paceNowPctH: number | null;
}

export interface RoleShare {
  role: BudgetRole;
  sharePct: number;
  kt: number;
  agents: number | null;
}

export interface BudgetRoles {
  window: "week" | "5h";
  roles: RoleShare[];
  unattributedPct: number | null;
  totalKt: number | null;
  /** Minutes since the team wrote it. */
  ageMin: number | null;
}

export interface TeamBudget {
  generatedAt: string | null;
  sampleAt: string | null;
  sampleAgeMin: number | null;
  week: BudgetWeek | null;
  rate: BudgetRate | null;
  verdict: { code: BudgetVerdictCode; brake: boolean; steps: number };
  brakes: BudgetBrake[];
  /** The pause between two jobs the workers keep now, in seconds. */
  pauseSec: number | null;
  burn: BudgetBurn;
  roles: BudgetRoles | null;
}

export type BudgetError = "budget_unreadable" | "budget_unavailable";
export type BudgetResult = { ok: true; budget: TeamBudget } | { ok: false; error: BudgetError };

const READ = "team_budget_read";
const LINES: readonly string[] = ["ahead", "on", "behind"];
const VERDICTS: readonly string[] = ["ahead", "lockout_risk", "on_pace", "behind", "no_data"];
const BRAKES: readonly string[] = ["pace_ahead", "lockout_risk", "daily_cap_stop", "recovering_after_freeze", "pause_between_jobs"];
const BURN_STATES: readonly string[] = ["off", "active", "expired", "unknown"];
const ROLES: readonly string[] = [
  "capitano", "sentinella", "assistente", "mentor", "dottore", "mantenitore", "scout", "analista", "scorer", "scrittore", "critico",
  "tesoriere", "closer",
];
const WINDOWS: readonly string[] = ["week", "5h"];
const MAX_ROLES = 20;
const MAX_BRAKES = 8;
const KNOWN_ERRORS: ReadonlySet<string> = new Set<BudgetError>(["budget_unreadable", "budget_unavailable"]);
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[0-9+\-:Z.]{0,13}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => key in value);

class Refused extends Error {}
const refuse = (): never => {
  throw new Refused();
};

function num(value: unknown, low: number, high: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) return refuse();
  return value;
}
function int(value: unknown, high: number): number | null {
  const n = num(value, 0, high);
  if (n !== null && !Number.isInteger(n)) return refuse();
  return n;
}
function stamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !STAMP.test(value) || Number.isNaN(Date.parse(value))) return refuse();
  return value;
}
function code<T extends string>(value: unknown, list: readonly string[]): T {
  if (typeof value !== "string" || !list.includes(value)) return refuse();
  return value as T;
}
function section(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !hasOnly(value, keys)) return refuse();
  return value;
}

const WEEK = ["usedPct", "remainingPct", "resetAtUnix", "activeHoursToReset", "idealUsedPct", "deviationPts", "line"];
const RATE = ["loPctH", "hiPctH", "nowPctH", "sustainablePctH", "projectedFinalPct", "wastedPct", "lockoutEarlyActiveH", "marginActiveH"];
const BURN = ["state", "grantedAt", "expiresAt", "remainingMin", "spentPts", "paceBeforePctH", "paceNowPctH"];
const ROLES_KEYS = ["window", "roles", "unattributedPct", "totalKt", "ageMin"];
const ROLE_KEYS = ["role", "sharePct", "kt", "agents"];
const TOP = ["generatedAt", "sampleAt", "sampleAgeMin", "week", "rate", "verdict", "brakes", "pauseSec", "burn", "roles"];

function pickBudget(reply: Record<string, unknown>): TeamBudget {
  if (!hasOnly(reply, TOP)) return refuse();
  const w = section(reply.week, WEEK);
  const r = section(reply.rate, RATE);
  const b = section(reply.burn, BURN);
  const ro = section(reply.roles, ROLES_KEYS);
  const v = reply.verdict;
  if (!b || !isRecord(v) || !hasOnly(v, ["code", "brake", "steps"]) || typeof v.brake !== "boolean") return refuse();
  const steps = num(v.steps, -6, 6);
  if (steps === null || !Number.isInteger(steps)) return refuse();
  if (!Array.isArray(reply.brakes) || reply.brakes.length > MAX_BRAKES) return refuse();
  let roles: BudgetRoles | null = null;
  if (ro) {
    if (!Array.isArray(ro.roles) || ro.roles.length > MAX_ROLES) return refuse();
    roles = {
      window: code(ro.window, WINDOWS),
      roles: ro.roles.map((item): RoleShare => {
        if (!isRecord(item) || !hasOnly(item, ROLE_KEYS)) return refuse();
        const sharePct = num(item.sharePct, 0, 100);
        const kt = num(item.kt, 0, 1e9);
        if (sharePct === null || kt === null) return refuse();
        return { role: code(item.role, ROLES), sharePct, kt, agents: int(item.agents, 200) };
      }),
      unattributedPct: num(ro.unattributedPct, 0, 100),
      totalKt: num(ro.totalKt, 0, 1e9),
      ageMin: int(ro.ageMin, 10_000_000),
    };
  }
  return {
    generatedAt: stamp(reply.generatedAt),
    sampleAt: stamp(reply.sampleAt),
    sampleAgeMin: int(reply.sampleAgeMin, 10_000_000),
    week: w && {
      usedPct: num(w.usedPct, 0, 10_000),
      remainingPct: num(w.remainingPct, 0, 10_000),
      resetAtUnix: int(w.resetAtUnix, 99_999_999_999),
      activeHoursToReset: num(w.activeHoursToReset, 0, 1_000),
      idealUsedPct: num(w.idealUsedPct, 0, 10_000),
      deviationPts: num(w.deviationPts, -10_000, 10_000),
      line: w.line === null ? null : code<BudgetLine>(w.line, LINES),
    },
    rate: r && {
      loPctH: num(r.loPctH, 0, 10_000),
      hiPctH: num(r.hiPctH, 0, 10_000),
      nowPctH: num(r.nowPctH, 0, 10_000),
      sustainablePctH: num(r.sustainablePctH, 0, 10_000),
      projectedFinalPct: num(r.projectedFinalPct, 0, 10_000),
      wastedPct: num(r.wastedPct, 0, 100),
      lockoutEarlyActiveH: num(r.lockoutEarlyActiveH, 0, 1_000),
      marginActiveH: num(r.marginActiveH, 0, 100),
    },
    verdict: { code: code(v.code, VERDICTS), brake: v.brake, steps },
    brakes: reply.brakes.map((item) => code<BudgetBrake>(item, BRAKES)),
    pauseSec: int(reply.pauseSec, 3600),
    burn: {
      state: code(b.state, BURN_STATES),
      grantedAt: stamp(b.grantedAt),
      expiresAt: stamp(b.expiresAt),
      remainingMin: int(b.remainingMin, 24 * 60),
      spentPts: num(b.spentPts, 0, 10_000),
      paceBeforePctH: num(b.paceBeforePctH, 0, 10_000),
      paceNowPctH: num(b.paceNowPctH, 0, 10_000),
    },
    roles,
  };
}

/** The reply of `team_budget_read` as the page uses it; anything off the closed shape is `budget_unavailable`. */
export function pickTeamBudget(reply: unknown): BudgetResult {
  const unavailable: BudgetResult = { ok: false, error: "budget_unavailable" };
  if (!isRecord(reply)) return unavailable;
  if (reply.ok === false) return { ok: false, error: typeof reply.error === "string" && KNOWN_ERRORS.has(reply.error) ? (reply.error as BudgetError) : "budget_unavailable" };
  if (reply.ok !== true) return unavailable;
  const { ok: _ok, ...rest } = reply;
  try {
    return { ok: true, budget: pickBudget(rest) };
  } catch (error) {
    if (error instanceof Refused) return unavailable;
    throw error;
  }
}

type Call = (command: string) => Promise<unknown>;
const nativeCall: Call = (command) => invoke<unknown>(command);

export async function readTeamBudget(call: Call = nativeCall): Promise<BudgetResult> {
  try {
    return pickTeamBudget(await call(READ));
  } catch {
    return { ok: false, error: "budget_unavailable" };
  }
}
