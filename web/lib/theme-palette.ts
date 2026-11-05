/**
 * The colours of the charts that tell CATEGORIES apart (the Dashboard's types, the roles of the team), derived from the
 * MAIN colour of the theme the person chose: the one of the titles' bars, the links, the accent (`--color-green` in
 * every palette, whatever hue the theme gives it). A green theme gets shades of green, an orange one shades of orange,
 * a blue one shades of blue, and so the chart changes with the theme, which a fixed list of colours never did.
 *
 * The recipe is fixed: the first colour is the accent itself; the next ones are the accent's own hue (±30°) at other
 * lightnesses and chromas, then its neighbours (±60°, ±90°), then its complement (+150°); the lightness is picked from a
 * band that stands out on the card of the theme (a dark card gets light colours, a light card dark ones). Chosen by a search so that,
 * in each of the thirteen palettes of the desktop and the web's light and dark, no two of the 14 look alike and each one stands
 * out on its card (theme-palette.test.ts checks every one of them on the real tokens).
 *
 * Pure functions here; `category-colors.ts` writes the result into the page as the variables `--cat-0 … --cat-13`.
 */

export const PALETTE_SIZE = 14;

type Rgb = [number, number, number];

/** [hue offset in degrees, lightness step 0..4, chroma scale] of each slot after the accent. */
const RECIPE: readonly [number, number, number][] = [
  [-30, 0, 0.4],
  [-30, 4, 0.4],
  [30, 3, 0.4],
  [-30, 1, 1],
  [30, 1, 0.7],
  [60, 2, 1],
  [-60, 2, 1],
  [-60, 3, 1],
  [90, 0, 0.7],
  [-90, 1, 0.7],
  [150, 0, 1],
  [150, 2, 0.4],
  [150, 3, 0.7],
];
const LIGHTNESS = { dark: [0.6, 0.68, 0.76, 0.84, 0.92], light: [0.34, 0.41, 0.48, 0.56, 0.64] } as const;
const MIN_CHROMA = 0.09;
const MAX_CHROMA = 0.2;

/** `#rgb` or `#rrggbb` (what every token of the themes is); anything else is not a colour this can use. */
export function parseHex(value: string | null | undefined): Rgb | null {
  const text = (value ?? "").trim();
  const full = /^#([0-9a-f]{6})$/i.exec(text)?.[1] ?? (/^#([0-9a-f]{3})$/i.test(text) ? text.slice(1).replace(/./g, (c) => c + c) : null);
  if (!full) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function toOklab([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklab([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

export function toOklch(rgb: Rgb): [number, number, number] {
  const [L, a, b] = toOklab(rgb);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

/** A colour of the given lightness, chroma and hue; the chroma is lowered until it fits in sRGB. */
function fromOklch(L: number, C: number, H: number): Rgb {
  let chroma = C;
  for (let i = 0; i < 40; i++) {
    const rad = (H * Math.PI) / 180;
    const linear = fromOklab([L, chroma * Math.cos(rad), chroma * Math.sin(rad)]);
    if (linear.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) return linear.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb;
    chroma *= 0.93;
  }
  return fromOklab([L, 0, 0]).map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb;
}

export function toHex(rgb: Rgb): string {
  return "#" + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
}

/** How different two colours look: the distance in OKLab, times 100. Under ~4 they are one colour to the eye. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const [L1, a1, b1] = toOklab(a);
  const [L2, a2, b2] = toOklab(b);
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2) * 100;
}

/**
 * The 14 colours of the categories for a theme whose main colour is `accent` on a card of colour `card`, as `#rrggbb`;
 * null when either is not a colour this can read (the charts then keep their fallback colours).
 */
export function categoryPalette(accent: string | null | undefined, card: string | null | undefined): string[] | null {
  const main = parseHex(accent);
  const back = parseHex(card);
  if (!main || !back) return null;
  const [, chroma, hue] = toOklch(main);
  const band = toOklch(back)[0] < 0.5 ? LIGHTNESS.dark : LIGHTNESS.light;
  const base = Math.max(chroma, MIN_CHROMA);
  return [
    toHex(main),
    ...RECIPE.map(([shift, step, scale]) => toHex(fromOklch(band[step], Math.min(MAX_CHROMA, scale * base), (hue + shift + 360) % 360))),
  ];
}
