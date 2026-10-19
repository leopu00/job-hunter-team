/**
 * How many of the navbar's links fit in a strip of a given width.
 *
 * The navbar is the one place every new page lands in (Agents, Mail, Settings…),
 * and it has a fixed width in a window of ~1068 px: each new link used to push
 * the last one under the buttons, and a stripe of padding bought back only the
 * first. So the strip shows the links that fit and the rest go in a «More» menu,
 * whatever their number. Pure, so it is tested without a layout.
 *
 * `widths` are the links' own widths, in order; `gap` the space between two
 * links; `available` the width of the strip; `reserve` the width of the «More»
 * button, kept free as soon as one link does not fit. When all of them fit, no
 * button is needed and `reserve` is not paid. A strip with no width at all is
 * a strip with no layout (a test without a browser, a hidden window): nothing
 * can be decided there, so every link is kept.
 */
export function fitCount(
  widths: readonly number[],
  gap: number,
  available: number,
  reserve: number,
): number {
  if (available <= 0) return widths.length;
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) return widths.length;
  let used = reserve;
  let count = 0;
  for (const w of widths) {
    const next = used + gap + w;
    if (next > available) break;
    used = next;
    count += 1;
  }
  return count;
}
