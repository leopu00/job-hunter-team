// Scala colore UNICA per gli score (20/07): spettro continuo rosso →
// arancio → ambra → giallo → giallo-verde → verde vivo, interpolato per
// punto. Condivisa da pin del globo, distribuzioni, liste, card e pagine
// team: un 65 e un 73 hanno sfumature visibilmente diverse ovunque.

const SPECTRUM_STOPS: Array<[number, [number, number, number]]> = [
  [0, [225, 55, 70]], // rosso
  [40, [235, 110, 55]], // arancio
  [55, [235, 165, 45]], // ambra
  [65, [210, 195, 50]], // giallo
  [75, [150, 205, 80]], // giallo-verde
  [85, [70, 215, 115]], // verde
  [100, [0, 232, 122]], // verde vivo brand
];

export function scoreToRgb(score: number | null): [number, number, number] {
  if (score == null) return [150, 165, 160]; // grigio-verde neutro
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < SPECTRUM_STOPS.length - 1; i++) {
    const [s0, c0] = SPECTRUM_STOPS[i];
    const [s1, c1] = SPECTRUM_STOPS[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1][1];
}

/** Colore CSS per uno score 0–100 (null = neutro). */
export function scoreGreenCss(score: number | null): string {
  const [r, g, b] = scoreToRgb(score);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Alias esplicito della stessa scala (naming usato dalle liste). */
export function scoreSpectrumCss(score: number | null | undefined): string {
  if (score == null) return "var(--color-dim)";
  return scoreGreenCss(score);
}

/**
 * The same scale as TEXT and small marks on the theme's own surfaces (the score numbers, their rings and bars in the
 * lists). On a dark base it is the scale itself. On a light base the bright amber or yellow of a 52 or a 65 is unreadable
 * on a white or grey card, so the colour is mixed with black: the light bases set `--score-ink-keep` (globals.css), and
 * 55% keeps every score at 4.5:1 or more on every light card and row of the web and the desktop. The hue stays, so a 65
 * still reads as the step between a 55 and a 75.
 */
export function scoreInkCss(score: number | null | undefined): string {
  if (score == null) return "var(--color-dim)";
  const [r, g, b] = scoreToRgb(score);
  return `color-mix(in oklab, rgb(${r}, ${g}, ${b}) var(--score-ink-keep, 100%), black)`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * An sRGB colour (0-255 channels) mixed with black in Oklab, keeping `keep` of it: what `color-mix(in oklab, C keep, black)`
 * gives in the browser. For what is drawn without CSS (the globe's beams, painted on a canvas) on a light base.
 */
export function darkenRgb([r, g, b]: [number, number, number], keep: number): [number, number, number] {
  const [R, G, B] = [r, g, b].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B) * keep;
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B) * keep;
  const q = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B) * keep;
  // scaling the cone responses scales L, a and b alike: the same as scaling the Oklab colour
  const [lc, mc, qc] = [l ** 3, m ** 3, q ** 3];
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * qc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * qc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * qc,
  ].map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255)) as [number, number, number];
}

/** How much of the score colour a light base keeps (globals.css sets the same for the CSS: --score-ink-keep). */
export const SCORE_INK_KEEP_LIGHT = 0.55;
