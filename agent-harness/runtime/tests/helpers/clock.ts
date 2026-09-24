/**
 * The flake that keeps coming back: a test that READS the clock while it
 * builds the data it will later compare.
 *
 * Four of them in one day, all the same shape — a seed that writes rows, a
 * second one built from the same source, and a comparison between the two. If
 * the machine's second ticks between the two seeds, one timestamp differs and
 * the test fails on something no change of ours caused. SQLite makes it easy
 * to miss: a touch trigger on `updated_at` reads the clock on ANY write, so
 * even a seed that pins its times gets the current second back if it writes
 * once more afterwards.
 *
 * The rule is: a seed FIXES the time instead of reading it, and it fixes it
 * after its last write. The way to prove a seed obeys is not to run it many
 * times and hope — it is to cross the boundary on purpose.
 */

/** Blocks until the system clock's second has ticked. Milliseconds, not more. */
export function crossSecondBoundary(): void {
  const until = Math.ceil(Date.now() / 1000) * 1000 + 2;
  while (Date.now() < until) {
    // Busy on purpose: the point is to cross the boundary, not to sleep.
  }
}
