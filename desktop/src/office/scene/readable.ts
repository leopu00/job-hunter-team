/**
 * The office's labels are drawn in the world, at the Godot office's sizes,
 * and the camera scales the world down to cover the window: in a window of
 * about a thousand pixels the minimum zoom is about a third, and a 10 px tag
 * ends up at 3 px. A label that the camera would shrink below a readable size
 * grows, around its own anchor, just enough to stay at that size on screen;
 * zoomed in, where it is already readable, it is drawn at its own size.
 */

/** The smallest on-screen size, in CSS pixels, of each kind of label (its font's x-height aside). */
export const READABLE_PX = {
  /** a department's tagline; its name, drawn larger in the same group, follows */
  departmentTagline: 10,
  /** a handoff table's tag ("RESEARCH → ANALYSIS") */
  handoffTag: 9,
  /** the status tag over an agent */
  stateTag: 10,
  /** the count over a pile */
  pileCount: 11,
  /** a speech bubble */
  bubble: 12,
} as const;

/** How much a label whose font is `fontPx` world pixels grows at `cameraScale` to be at least `minPx` on screen; never below 1. */
export function readableScale(fontPx: number, cameraScale: number, minPx: number): number {
  if (!(fontPx > 0) || !(cameraScale > 0) || !(minPx > 0)) return 1;
  return Math.max(1, minPx / (fontPx * cameraScale));
}
