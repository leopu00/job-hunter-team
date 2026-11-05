import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scoreInkCss, scoreSpectrumCss, scoreToRgb } from "./score-color";
import { toOklab } from "./theme-palette";

const here = path.dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(path.join(here, "../app/globals.css"), "utf8").replace(/\r\n?/g, "\n");
const desktop = readFileSync(path.join(here, "../../desktop/src/dashboard/dashboard.css"), "utf8").replace(/\r\n?/g, "\n");

// what the browser does with color-mix(in oklab, C keep%, black): every Oklab component scaled by keep
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function mixWithBlack([r, g, b]: [number, number, number], keep: number): [number, number, number] {
  const [L, A, B] = toOklab([r / 255, g / 255, b / 255]).map((v) => v * keep);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as [number, number, number];
}
const luminance = (c: number[]) => c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const hexToUnit = (hex: string) => [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16) / 255);
const ratio = (a: number[], b: number[]) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

/** Every surface of every light base the lists can sit on: the web's light, and each light palette of the desktop. */
function lightSurfaces(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const web = /^html\[data-theme="light"\]\s*\{([^}]*)\}/m.exec(globals)![1];
  for (const m of web.matchAll(/--color-(void|deep|panel|card|row):\s*(#[0-9a-f]{6})/gi)) out.push([`web ${m[1]}`, m[2]]);
  for (const block of desktop.matchAll(/:root\[data-jht-theme="([a-z]+)"\]\s*\{([^}]*)\}/g)) {
    if (!/color-scheme:\s*light/.test(block[2])) continue;
    for (const m of block[2].matchAll(/--color-(void|deep|panel|card|row):\s*(#[0-9a-f]{6})/gi)) out.push([`${block[1]} ${m[1]}`, m[2]]);
  }
  return out;
}

describe("the score as text on the theme's surfaces (scoreInkCss)", () => {
  it("is the score's own colour on a dark base, and that colour mixed with black where a light base asks for it", () => {
    const [r, g, b] = scoreToRgb(52);
    expect(scoreInkCss(52)).toBe(`color-mix(in oklab, rgb(${r}, ${g}, ${b}) var(--score-ink-keep, 100%), black)`);
    expect(scoreInkCss(null)).toBe(scoreSpectrumCss(null));
    expect(scoreInkCss(undefined)).toBe("var(--color-dim)");
  });

  it("is asked to darken only by the light base, never by the dark one", () => {
    const keep = /^html\[data-theme="light"\]\s*\{[^}]*--score-ink-keep:\s*(\d+)%;/m.exec(globals);
    expect(keep?.[1]).toBe("55");
    expect(globals.match(/--score-ink-keep:/g)).toHaveLength(1);
    expect(desktop).not.toMatch(/--score-ink-keep:/);
  });

  it("reads at 4.5:1 or more for every score from 0 to 100 on every light surface (the amber 52 and the yellow 65 did not)", () => {
    const surfaces = lightSurfaces();
    expect(surfaces.length).toBeGreaterThanOrEqual(30);
    let before = Infinity;
    for (let score = 0; score <= 100; score++) {
      const ink = mixWithBlack(scoreToRgb(score), 0.55);
      const raw = scoreToRgb(score).map((v) => v / 255);
      for (const [name, hex] of surfaces) {
        expect(ratio(ink, hexToUnit(hex)), `score ${score} on ${name}`).toBeGreaterThanOrEqual(4.5);
        before = Math.min(before, ratio(raw, hexToUnit(hex)));
      }
    }
    // the reason for it: without the mix some score is under 2:1 on a light card
    expect(before).toBeLessThan(2);
  });
});
