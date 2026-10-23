/**
 * Colour contrast, pure: no DOM, no storage. Two measures on #rrggbb colours:
 *  - the WCAG 2 ratio (1 to 21), the one the accessibility thresholds are written in (4.5:1 for text,
 *    3:1 for icons, outlines and other graphics);
 *  - the OKLCH lightness gap (0 to 1), which follows how bright two colours look rather than how the
 *    formula weighs them, so it also tells apart two colours that pass the ratio but look alike.
 * The palette tests and the guard of the personal theme read the same functions.
 */

export type Oklch = { l: number; c: number; h: number };

const HEX = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map(toLinear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio, 1 to 21, the same whichever colour is the text. */
export function wcagContrast(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The colour in OKLCH (lightness 0..1, chroma, hue in degrees). */
export function toOklch(hex: string): Oklch {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  const hue = chroma < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

/** How far apart two colours are in perceived lightness, 0 to 1. */
export function lightnessGap(first: string, second: string): number {
  return Math.abs(toOklch(first).l - toOklch(second).l);
}
