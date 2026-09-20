/**
 * `difflib.SequenceMatcher(None, a, b).ratio()`, exactly.
 *
 * The dedup's third level skips a position whose title is "similar" to one
 * already saved, and similar means a ratio above 0.85 as Python's difflib
 * computes it. A different similarity would make the API SCOUT save what the
 * TUI SCOUT skips, so this is the stdlib algorithm, step for step: the b2j
 * index, the autojunk purge of popular elements when `b` has 200 items or
 * more, the longest-match search with its extension over popular elements,
 * and the recursive matching blocks. Items are code points, as Python's
 * `str` iterates.
 */

type Match = [number, number, number];

export function sequenceRatio(aText: string, bText: string): number {
  const a = Array.from(aText);
  const b = Array.from(bText);
  const total = a.length + b.length;
  if (total === 0) return 1.0;

  // __chain_b: every position of every item of b; no junk function.
  const b2j = new Map<string, number[]>();
  b.forEach((item, i) => {
    const list = b2j.get(item);
    if (list) list.push(i);
    else b2j.set(item, [i]);
  });
  if (b.length >= 200) {
    const ntest = Math.floor(b.length / 100) + 1;
    for (const [item, idxs] of [...b2j]) if (idxs.length > ntest) b2j.delete(item);
  }

  const findLongestMatch = (alo: number, ahi: number, blo: number, bhi: number): Match => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = next;
    }
    // With no junk function nothing is junk, so only the first pair of
    // Python's four extension loops can move: over the popular items the
    // purge removed from b2j.
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    return [besti, bestj, bestsize];
  };

  // get_matching_blocks: the sum of the sizes is all ratio() needs, and
  // collapsing adjacent blocks does not change it.
  let matches = 0;
  const queue: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
    if (k === 0) continue;
    matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return (2.0 * matches) / total;
}
