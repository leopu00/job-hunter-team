/**
 * How long the setup waits before it looks at the profile again. The first looks come quickly (the person has
 * just answered the Assistant), then the pace slows, so a slow computer is not asked the same thing every two
 * seconds for as long as the person keeps talking.
 */
export const PROFILE_RECHECK_STEPS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000];

/** The wait after the `looks`-th look (0 for the first); the last step repeats. */
export function profileRecheckDelay(looks: number): number {
  return PROFILE_RECHECK_STEPS_MS[Math.min(Math.max(0, looks), PROFILE_RECHECK_STEPS_MS.length - 1)];
}
