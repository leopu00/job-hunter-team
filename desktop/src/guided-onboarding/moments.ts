/**
 * The moments of the guided onboarding that follows the setup: the Assistant leads the person from the
 * profile interview to a running team. Nothing here drives anything; every moment is DERIVED from what the
 * machine says, so a restart, a closed window or a step done elsewhere puts the person back where they are.
 *
 * The moments, in order: `interview` (the profile is still being filled), `confirm` (its fields are all
 * there, the profile is not yet confirmed), `plan` (the subscription plan is not declared), `team` (the plan
 * is declared, the team has not started to work), `started` (it has).
 */

/**
 * What `shared/skills/first_run.py` writes in `state/first-run.json`, as far as the guide needs it. A first run with
 * no file yet is `awaiting_profile` with no workers.
 */
export interface FirstRunSignal {
  phase: "awaiting_profile" | "burst" | "steady";
  /** How many workers the burst launched (the roster's count); 0 until it has launched one. */
  workers: number;
  /** The subscription plan is declared (a plan «I don't know» is a declared plan: the burst starts with one worker). */
  planDeclared: boolean;
}

export interface GuidedSignals {
  /** The profile fields filled, and how many the profile needs (the card's own count). */
  profileFilled: number;
  profileTotal: number;
  /** The profile is confirmed (the flag the setup's gate already reads). */
  profileReady: boolean;
  captainRunning: boolean;
  /** null: not read yet, or not readable. It never counts as started. */
  firstRun: FirstRunSignal | null;
}

export type GuidedMoment = "interview" | "confirm" | "plan" | "team" | "started";

/**
 * The team has STARTED when the Captain runs and the first-run burst is open with at least one worker
 * launched. A start button that succeeded is not enough: the team must have begun to work. A burst that
 * is already over (`steady`) was open once, so it counts.
 */
export function teamStarted(signals: Pick<GuidedSignals, "captainRunning" | "firstRun">): boolean {
  const run = signals.firstRun;
  if (!signals.captainRunning || !run) return false;
  if (run.phase === "steady") return true;
  return run.phase === "burst" && run.workers >= 1;
}

export function guidedMoment(signals: GuidedSignals): GuidedMoment {
  if (teamStarted(signals)) return "started";
  if (!signals.profileReady) {
    return signals.profileTotal > 0 && signals.profileFilled >= signals.profileTotal ? "confirm" : "interview";
  }
  // Nothing readable of the first run: wait as for a team that is starting (the column says it is late after the
  // patience, and the way out is there) rather than ask for a plan that may be declared already.
  if (!signals.firstRun) return "team";
  if (!signals.firstRun.planDeclared) return "plan";
  return "team";
}

/**
 * Whether the setup's gate stays «required»: until the team has started, unless the person chose «continue
 * later». That choice always releases it, whatever the signals say: there is no state without a way out.
 */
export function gateStaysRequired(signals: GuidedSignals, choseLater: boolean): boolean {
  if (choseLater) return false;
  return guidedMoment(signals) !== "started";
}

/** How long the team may take to start before the column says so and offers to go on later (ms). */
export const TEAM_START_PATIENCE_MS = 5 * 60 * 1000;

/** `late` once the wait in the `team` moment has gone past the patience; never a stall: the way out is always offered. */
export function teamWaitState(waitedMs: number): "waiting" | "late" {
  return waitedMs >= TEAM_START_PATIENCE_MS ? "late" : "waiting";
}
