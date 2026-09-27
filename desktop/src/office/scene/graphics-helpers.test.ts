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
  it("is only what is drawn: the floor and the backdrop behind it, never the dark band of the world", () => {
    const backdrop = [{ draw: { x: 240, y: -52, w: 2920, h: 72 } }, { draw: { x: 240, y: 20, w: 2920, h: 120 } }];
    const layout = { world: WORLD, floor: FLOOR, backdrop } as unknown as OfficeLayout;
    expect(cameraBounds(layout)).toEqual({ x: 240, y: -52, w: 2920, h: 2052 });
  });

  it("at the smallest zoom the drawn office fills the whole view, however wide or tall", async () => {
    const { clamp, cover, pan } = await import("./camera");
    // no backdrop here: what is drawn is the floor alone
    const drawn = FLOOR;
    const bounds = cameraBounds({ world: WORLD, floor: FLOOR } as unknown as OfficeLayout);
    for (const view of [{ w: 1600, h: 835 }, { w: 1512, h: 917 }, { w: 2560, h: 600 }, { w: 700, h: 1300 }]) {
      // the first framing, and the framing pushed as far as panning goes in each direction
      const start = clamp(cover(view, bounds), view, bounds);
      for (const c of [start, pan(start, { x: 1e5, y: 1e5 }, view, bounds), pan(start, { x: -1e5, y: -1e5 }, view, bounds)]) {
        // the drawn floor's edges are at or past the view's edges on every side: no void band
        expect(drawn.x * c.scale + c.x).toBeLessThanOrEqual(0.001);
        expect(drawn.y * c.scale + c.y).toBeLessThanOrEqual(0.001);
        expect((drawn.x + drawn.w) * c.scale + c.x).toBeGreaterThanOrEqual(view.w - 0.001);
        expect((drawn.y + drawn.h) * c.scale + c.y).toBeGreaterThanOrEqual(view.h - 0.001);
      }
    }
  });
});

describe("the machines (tesseract, hologram, printer, door)", async () => {
  const fx = await import("./effects");
  const pose = (x: number, y: number, mode: "walk" | "work" | "idle" = "work") =>
    ({ uid: "a", role: "scout", sheet: "s", pos: { x, y }, mode, facing: "down", flipped: false, frame: 0, carrying: false }) as const;

  it("the box has three fading rays at each of its four corners", () => {
    const rays = fx.tesseractRays(FLOOR);
    expect(rays).toHaveLength(4 * 3 * (fx.TESSERACT.steps - 1));
    expect(rays[0].from).toEqual({ x: FLOOR.x, y: FLOOR.y });
    expect(rays[0].alpha).toBeCloseTo(0.3);
    expect(rays[fx.TESSERACT.steps - 2].alpha).toBeLessThan(0.01);
    expect(fx.tesseractPulse(0)).toBeCloseTo(0.8);
  });

  it("the hologram's meridians turn and squash between 0.05 and 1", () => {
    const f = fx.hologramFrame(0);
    expect(f.squash[0]).toBeCloseTo(1);
    for (const t of [0.3, 1.7, 5]) for (const k of fx.hologramFrame(t).squash) expect(k).toBeGreaterThanOrEqual(0.05);
    const globe = fx.hologramGlobe({ x: 675, y: 435, w: 200, h: 180 });
    expect(globe.radius).toBe(60);
    expect(globe.centre.x).toBe(775);
  });

  it("the printer works only while someone stands at it, the door opens for anyone near", () => {
    const printer = { x: 1265, y: 300 };
    expect(fx.someoneStandsAt([pose(1270, 305)], printer, 70)).toBe(true);
    expect(fx.someoneStandsAt([pose(1270, 305, "walk")], printer, 70)).toBe(false);
    expect(fx.someoneStandsAt([pose(1500, 300)], printer, 70)).toBe(false);
    expect(fx.someoneNear([pose(1700, 1950, "walk")], { x: 1700, y: 2000 }, 120)).toBe(true);
    expect(fx.printerFrame(0.1)).toEqual({ ledOn: true, sheet: 0.125 });
  });

  it("the door slides at 3.5 a second and its leaves shrink into the posts", () => {
    expect(fx.doorStep(0, true, 0.1)).toBeCloseTo(0.35);
    expect(fx.doorStep(1, false, 1)).toBe(0);
    const shut = fx.doorLeaves(0);
    const open = fx.doorLeaves(1);
    expect(shut[0].w).toBe(70);
    expect(open[0].w).toBe(2);
  });
});
