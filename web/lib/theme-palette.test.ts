import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { categoryPalette, colorDistance, PALETTE_SIZE, parseHex, toOklch } from "./theme-palette";

const here = path.dirname(fileURLToPath(import.meta.url));

// ── the REAL tokens of the themes: the desktop's thirteen palettes, the web's dark and light ─────────────────────────
type Tokens = Record<string, string>;
function tokensOf(block: string): Tokens {
  const t: Tokens = {};
  for (const m of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) t[m[1]] = m[2];
  return t;
}
function loadThemes(): Record<string, Tokens> {
  const desktop = readFileSync(path.join(here, "../../desktop/src/dashboard/dashboard.css"), "utf8");
  const web = readFileSync(path.join(here, "../app/globals.css"), "utf8");
  const themes: Record<string, Tokens> = {};
  for (const m of desktop.matchAll(/:root\[data-jht-theme="([a-z]+)"\]\s*\{([^}]*)\}/g)) themes[`desktop ${m[1]}`] = tokensOf(m[2]);
  const dark = /^@theme inline\s*\{([^}]*)\}/m.exec(web);
  const light = /^html\[data-theme="light"\]\s*\{([^}]*)\}/m.exec(web);
  if (dark) themes["web dark"] = tokensOf(dark[1]);
  if (light) themes["web light"] = tokensOf(light[1]);
  return themes;
}
const THEMES = loadThemes();
const rgb = (hex: string) => parseHex(hex)!;
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

describe("the colours of the categories, derived from the theme's main colour", () => {
  it("are read from the 15 real themes (13 of the desktop, the web's dark and light)", () => {
    expect(Object.keys(THEMES).length).toBeGreaterThanOrEqual(15);
    for (const [name, t] of Object.entries(THEMES)) expect(parseHex(t.green) && parseHex(t.card), name).toBeTruthy();
  });

  it("are 14 different colours in every theme, and each one stands out on the theme's own card", () => {
    for (const [name, t] of Object.entries(THEMES)) {
      const palette = categoryPalette(t.green, t.card)!;
      expect(palette, name).toHaveLength(PALETTE_SIZE);
      for (const color of palette) expect(color, name).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(palette).size, name).toBe(PALETTE_SIZE);
      for (let i = 0; i < palette.length; i++) {
        expect(colorDistance(rgb(palette[i]), rgb(t.card)), `${name}: colour ${i} on the card`).toBeGreaterThanOrEqual(20);
        for (let j = i + 1; j < palette.length; j++) {
          expect(colorDistance(rgb(palette[i]), rgb(palette[j])), `${name}: colours ${i} and ${j}`).toBeGreaterThanOrEqual(7);
        }
      }
    }
  });

  it("start with the main colour itself and stay in its family: shades of the accent's hue, not a fixed list", () => {
    for (const [name, t] of Object.entries(THEMES)) {
      const palette = categoryPalette(t.green, t.card)!;
      expect(palette[0], name).toBe(t.green.toLowerCase());
      const hue = toOklch(rgb(t.green))[2];
      for (const color of palette.slice(0, 6)) {
        const [, chroma, h] = toOklch(rgb(color));
        if (chroma > 0.02) expect(hueGap(h, hue), `${name}: ${color}`).toBeLessThanOrEqual(35);
      }
    }
  });

  it("CHANGE with the theme: an orange theme is not a blue one, and no colour is shared between themes of other hues", () => {
    const names = Object.keys(THEMES);
    let compared = 0;
    for (const a of names) {
      for (const b of names) {
        if (a >= b) continue;
        const ha = toOklch(rgb(THEMES[a].green))[2];
        const hb = toOklch(rgb(THEMES[b].green))[2];
        if (hueGap(ha, hb) < 40) continue; // two greens are allowed to look alike
        compared++;
        const pa = categoryPalette(THEMES[a].green, THEMES[a].card)!;
        const pb = categoryPalette(THEMES[b].green, THEMES[b].card)!;
        expect(pa.filter((c) => pb.includes(c)), `${a} / ${b}`).toEqual([]);
        // the main colour, the first of each, is in another hue
        expect(hueGap(toOklch(rgb(pa[0]))[2], toOklch(rgb(pb[0]))[2])).toBeGreaterThanOrEqual(35);
      }
    }
    expect(compared).toBeGreaterThan(20);
    // the three themes the operator looks at: the orange one, a green one, a blue one
    const dusk = THEMES["desktop dusk"];
    const sage = THEMES["desktop sage"];
    const ocean = THEMES["desktop ocean"];
    expect(hueGap(toOklch(rgb(categoryPalette(dusk.green, dusk.card)![0]))[2], 47)).toBeLessThan(5); // orange
    expect(hueGap(toOklch(rgb(categoryPalette(sage.green, sage.card)![0]))[2], 148)).toBeLessThan(5); // green
    expect(hueGap(toOklch(rgb(categoryPalette(ocean.green, ocean.card)![0]))[2], 204)).toBeLessThan(5); // blue-teal
  });

  it("uses lighter colours on a dark card and darker ones on a light card", () => {
    const dark = categoryPalette(THEMES["desktop dusk"].green, THEMES["desktop dusk"].card)!.slice(1);
    const light = categoryPalette(THEMES["desktop sage"].green, THEMES["desktop sage"].card)!.slice(1);
    const lightness = (p: string[]) => p.reduce((s, c) => s + toOklch(rgb(c))[0], 0) / p.length;
    expect(lightness(dark)).toBeGreaterThan(0.6);
    expect(lightness(light)).toBeLessThan(0.55);
  });

  it("gives nothing for a value that is not a colour (the charts keep their fallback)", () => {
    for (const bad of [null, undefined, "", "var(--color-blue)", "red", "#12", "#gggggg", "rgb(1,2,3)"]) {
      expect(categoryPalette(bad, "#112233"), String(bad)).toBeNull();
      expect(categoryPalette("#112233", bad), String(bad)).toBeNull();
    }
    expect(categoryPalette(" #abc ", "#000000")).toHaveLength(PALETTE_SIZE);
  });
});
