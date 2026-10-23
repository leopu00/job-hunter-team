/**
 * How soon the panel reads the terminal of the agent in view again. The native side says the pace
 * with each read: live (2 s) where a read costs no ssh connection of its own, slow (10 s) where it
 * does. A server that turns this computer away for a while (`ssh_rate_limited`) doubles the wait,
 * up to a minute; the next good read brings the pace back.
 */
export const SCREEN_LIVE_MS = 2_000;
export const SCREEN_SLOW_MS = 10_000;
export const SCREEN_BACKOFF_MAX_MS = 60_000;

/** The pace a reply says, within the bounds; an older native side says none: the slow one, as before. */
export function screenPace(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= SCREEN_LIVE_MS && value <= SCREEN_BACKOFF_MAX_MS
    ? value
    : SCREEN_SLOW_MS;
}

export type ScreenRead = { ok: true; pace: number } | { ok: false; code: string };

/** The wait before the next read, after `last` and what the read just gave. */
export function nextScreenWait(last: number, read: ScreenRead): number {
  if (read.ok) return read.pace;
  if (read.code === "ssh_rate_limited") return Math.min(Math.max(last, SCREEN_SLOW_MS) * 2, SCREEN_BACKOFF_MAX_MS);
  return last;
}
