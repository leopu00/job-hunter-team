// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromOklch, toOklch, wcagContrast } from "./contrast";

const css = readFileSync(new URL("../dashboard/dashboard.css", import.meta.url), "utf8");
const palette = [...new Set([...css.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase()))];

describe("fromOklch", () => {
  it("gives back every colour of the eleven palettes", () => {
    expect(palette.length).toBeGreaterThan(100);
    for (const hex of palette) expect(fromOklch(toOklch(hex)), hex).toBe(hex);
  });

  it("holds the lightness asked and keeps the hue when a vivid colour does not fit", () => {
    for (const l of [0.05, 0.3, 0.6, 0.9, 0.97]) {
      const vivid = { l, c: 0.4, h: 145 };
      const hex = fromOklch(vivid);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      const back = toOklch(hex);
      expect(Math.abs(back.l - l)).toBeLessThan(0.02);
      if (back.c > 0.02) expect(Math.abs(back.h - 145)).toBeLessThan(6);
      expect(back.c).toBeLessThan(0.4);
    }
  });

  it("returns pure black and white at the ends, and clips a lightness out of range", () => {
    expect(fromOklch({ l: 0, c: 0.3, h: 30 })).toBe("#000000");
    expect(fromOklch({ l: 1, c: 0.3, h: 30 })).toBe("#ffffff");
    expect(fromOklch({ l: -2, c: 0, h: 0 })).toBe("#000000");
    expect(fromOklch({ l: 5, c: 0, h: 0 })).toBe("#ffffff");
    expect(wcagContrast(fromOklch({ l: 0.5, c: 0, h: 0 }), "#ffffff")).toBeGreaterThan(4);
  });
});
