import { describe, expect, it } from "vitest";
import type { OfficeLayout, Rect } from "../contract";
import { cameraBounds } from "../layout-items";
import { darkness, lighting, LAMPS, outsideBands, vignetteAlpha } from "./atmosphere";
import { sheetPlacements, stackBase, stackSizes, towerHeight, type PaperRule } from "./paper";

// FurnitureDefs.WORLD and FLOOR of the Godot office.
const WORLD: Rect = { x: 0, y: -420, w: 3400, h: 2560 };
const FLOOR: Rect = { x: 240, y: 140, w: 2920, h: 1860 };

describe("day and night (day_night.gd)", () => {
  it("is day from 9 to 17, night from 21 to 5, and fades at dawn and dusk", () => {
    expect(darkness(12)).toBe(0);
    expect(darkness(23)).toBe(1);
    expect(darkness(3)).toBe(1);
    expect(darkness(7)).toBeCloseTo(0.5);
    expect(darkness(19)).toBeCloseTo(0.5);
    expect(darkness(20 + 14 / 60)).toBeCloseTo(0.8083, 3);
  });

  it("tints the world from the day's to the night's modulate, and lights the lamps only in the dark", () => {
    expect(lighting(0).tint).toBe(0xfafaff);
    expect(lighting(1).tint).toBe(0x99a1d6);
    expect(lighting(0).lampFactor).toBe(0);
    expect(lighting(1).lampFactor).toBe(2);
    expect(lighting(1).dayFactor).toBe(0);
    expect(lighting(0).dayFactor).toBe(1);
    expect(LAMPS).toHaveLength(12);
  });

  it("the band outside the box covers the world but never the floor", () => {
    const bands = outsideBands(WORLD, FLOOR);
    const area = bands.reduce((a, r) => a + r.w * r.h, 0);
    expect(area).toBe(WORLD.w * WORLD.h - FLOOR.w * FLOOR.h);
    for (const r of bands) expect(r.w).toBeGreaterThan(0);
  });

  it("the vignette is clear in the middle and dark at the corners", () => {
    expect(vignetteAlpha(0.5, 0.46)).toBe(0);
    expect(vignetteAlpha(0, 0)).toBeGreaterThan(0.4);
    expect(vignetteAlpha(1, 1)).toBeLessThanOrEqual(0.95);
  });
});

// paper_pile.gd's constants.
const RULE: PaperRule = {
  image: { src: "/office/furniture/paper_pile_1.png" },
  width: 38,
  rise: 1.05,
  perStack: 40,
  maxStacks: 12,
  columns: 6,
  basisX: { x: 32, y: 8.5 },
  basisY: { x: -36, y: 30 },
};

describe("paper piles (paper_pile.gd)", () => {
  it("one sheet per document, in stacks of 40", () => {
    expect(stackSizes(0, RULE)).toEqual([]);
    expect(stackSizes(95, RULE)).toEqual([40, 40, 15]);
    expect(sheetPlacements(95, RULE)).toHaveLength(95);
  });

  it("past 12 full stacks the surplus is spread evenly, not piled on one tower", () => {
    const sizes = stackSizes(12 * 40 + 30, RULE);
    expect(sizes).toHaveLength(12);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(510);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("stacks sit along the table's axes, centred, the next row towards the front", () => {
    expect(stackBase(0, 1, RULE)).toEqual({ x: 0, y: 0 });
    expect(stackBase(0, 2, RULE)).toEqual({ x: -16, y: -4.25 });
    const front = stackBase(6, 7, RULE);
    const back = stackBase(0, 7, RULE);
    expect(front.y).toBeGreaterThan(back.y);
  });

  it("the tower is the tallest stack", () => {
    expect(towerHeight(95, RULE)).toBeCloseTo(42);
    expect(towerHeight(0, RULE)).toBe(0);
  });
});

describe("cameraBounds", () => {
  it("is the whole world, as Godot's camera limits", () => {
    const layout = { world: WORLD, floor: FLOOR } as unknown as OfficeLayout;
    expect(cameraBounds(layout)).toEqual(WORLD);
  });
});
