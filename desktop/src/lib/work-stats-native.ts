import { invoke } from "@tauri-apps/api/core";

/**
 * What the team did in the nights it worked, read and cleared through the native `work_stats_read` and
 * `work_stats_clear` commands (the work-hours statistics of the team on this computer or on the linked
 * VPS). Only numbers: the closed list of fields below is all the archive holds, and a reply that carries
 * anything else, or a value off its range, is `stats_unavailable` and never a number made up.
 *
 * A «night» is the hours worked inside one window of the working hours, dated by the local day the window
 * started (a 22:00-08:00 window of Monday is Monday's night); for hours with no night in them, or 24/7, it
 * is a day. `turnMedianSec` has no source yet and is always `null`.
 */

export interface WorkNight {
  /** YYYY-MM-DD, the local date the night started. */
  date: string;
  hoursActive: number;
  found: number;
  /** `null` while no position of the night has its score yet. */
  aboveThreshold: number | null;
  /** The score threshold in force that night; `null` for a night without one. */
  scoreThreshold: number | null;
  /** Points of the weekly budget used; `null` when the night has no reading. */
  consumptionPct: number | null;
  turnMedianSec: number | null;
}

export interface WorkStats {
  nights: WorkNight[];
  from: string | null;
  to: string | null;
  /** ISO time of the last hour archived, or `null`. */
  lastObservation: string | null;
  retentionDays: number;
  /** Today's score threshold. */
  threshold: number | null;
}

export type WorkStatsError = "stats_unreadable" | "stats_unavailable" | "stats_clear_failed";
export type WorkStatsResult = { ok: true; stats: WorkStats } | { ok: false; error: WorkStatsError };
export type WorkStatsClearResult = { ok: true } | { ok: false; error: WorkStatsError };

const READ = "work_stats_read";
const CLEAR = "work_stats_clear";
const MAX_NIGHTS = 400;
const NIGHT_KEYS = ["date", "hoursActive", "found", "aboveThreshold", "scoreThreshold", "consumptionPct", "turnMedianSec"];
const STATS_KEYS = ["lastObservation", "nights", "from", "to", "retentionDays", "threshold"];
const KNOWN_ERRORS: ReadonlySet<string> = new Set<WorkStatsError>(["stats_unreadable", "stats_unavailable", "stats_clear_failed"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sameKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const number = (value: unknown, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
const numberOrNull = (value: unknown, max: number): value is number | null => value === null || number(value, max);
const dayOrNull = (value: unknown): value is string | null => value === null || (typeof value === "string" && DAY.test(value));

function pickNight(value: unknown): WorkNight | null {
  if (!isRecord(value) || !sameKeys(value, NIGHT_KEYS)) return null;
  const { date, hoursActive, found, aboveThreshold, scoreThreshold, consumptionPct, turnMedianSec } = value;
  if (typeof date !== "string" || !DAY.test(date) || !number(hoursActive, 25) || !number(found, 1_000_000)) return null;
  if (!numberOrNull(aboveThreshold, 1_000_000) || !numberOrNull(scoreThreshold, 100) || !numberOrNull(consumptionPct, 100_000) || !numberOrNull(turnMedianSec, 86_400)) return null;
  return { date, hoursActive, found, aboveThreshold, scoreThreshold, consumptionPct, turnMedianSec };
}

/** The reply of `work_stats_read` as the page uses it; anything off the closed shape is `stats_unavailable`. */
export function pickWorkStats(reply: unknown): WorkStatsResult {
  const unavailable: WorkStatsResult = { ok: false, error: "stats_unavailable" };
  if (!isRecord(reply)) return unavailable;
  if (reply.ok === false) return { ok: false, error: typeof reply.error === "string" && KNOWN_ERRORS.has(reply.error) ? (reply.error as WorkStatsError) : "stats_unavailable" };
  if (reply.ok !== true) return unavailable;
  const { ok: _ok, ...rest } = reply;
  if (!sameKeys(rest, STATS_KEYS) || !Array.isArray(rest.nights) || rest.nights.length > MAX_NIGHTS) return unavailable;
  const nights = rest.nights.map(pickNight);
  const lastObservation = rest.lastObservation;
  if (nights.some((night) => night === null) || !dayOrNull(rest.from) || !dayOrNull(rest.to)) return unavailable;
  if (lastObservation !== null && (typeof lastObservation !== "string" || Number.isNaN(Date.parse(lastObservation)))) return unavailable;
  if (typeof rest.retentionDays !== "number" || !Number.isInteger(rest.retentionDays) || rest.retentionDays < 1 || rest.retentionDays > 365) return unavailable;
  if (!numberOrNull(rest.threshold, 100)) return unavailable;
  return {
    ok: true,
    stats: { nights: nights as WorkNight[], from: rest.from, to: rest.to, lastObservation, retentionDays: rest.retentionDays, threshold: rest.threshold },
  };
}

type Call = (command: string) => Promise<unknown>;
const nativeCall: Call = (command) => invoke<unknown>(command);

export async function readWorkStats(call: Call = nativeCall): Promise<WorkStatsResult> {
  try {
    return pickWorkStats(await call(READ));
  } catch {
    return { ok: false, error: "stats_unavailable" };
  }
}

/** Removes the archive; the team starts collecting again at its next check. */
export async function clearWorkStats(call: Call = nativeCall): Promise<WorkStatsClearResult> {
  try {
    const reply = await call(CLEAR);
    if (isRecord(reply) && reply.ok === true && Object.keys(reply).length === 1) return { ok: true };
    if (isRecord(reply) && reply.ok === false && typeof reply.error === "string" && KNOWN_ERRORS.has(reply.error)) return { ok: false, error: reply.error as WorkStatsError };
    return { ok: false, error: "stats_clear_failed" };
  } catch {
    return { ok: false, error: "stats_clear_failed" };
  }
}
