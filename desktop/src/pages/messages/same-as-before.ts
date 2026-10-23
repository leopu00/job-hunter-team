/**
 * The reading loop brings a whole page every few seconds, mostly the same as the last one. A new
 * array in the state redraws the whole conversation; with this, a page with the same content keeps
 * the state it had, and nothing is drawn again.
 */
export function sameAsBefore<T>(before: T, after: T): T {
  if (before === after) return before;
  try {
    return JSON.stringify(before) === JSON.stringify(after) ? before : after;
  } catch {
    // not serialisable: one more render is the safe side
    return after;
  }
}
