import { describe, expect, it } from "vitest";
import type { AgentPose, CharacterSheet, Rect } from "../contract";
import { clamp, fit, MAX_SCALE, pan, toWorld, zoomAt } from "./camera";
import { routeForClick } from "./click";
import { cellRect, feetAnchor, pickCell } from "./frames";

// FurnitureDefs.FLOOR of the Godot office.
const FLOOR: Rect = { x: 240, y: 140, w: 2920, h: 1860 };
const VIEW = { w: 1200, h: 700 };

describe("camera", () => {
  it("fits the whole floor, centred", () => {
    const cam = fit(VIEW, FLOOR);
    expect(cam.scale).toBeCloseTo(Math.min(1200 / 2920, 700 / 1860));
    const topLeft = { x: FLOOR.x * cam.scale + cam.x, y: FLOOR.y * cam.scale + cam.y };
    const bottomRight = { x: (FLOOR.x + FLOOR.w) * cam.scale + cam.x, y: (FLOOR.y + FLOOR.h) * cam.scale + cam.y };
    expect(topLeft.y).toBeCloseTo(0);
    expect(bottomRight.y).toBeCloseTo(700);
    expect(topLeft.x + bottomRight.x).toBeCloseTo(1200);
  });

  it("zooms around the pointer: the world point under it stays there", () => {
    const cam = fit(VIEW, FLOOR);
    const at = { x: 700, y: 300 };
    const before = toWorld(cam, at);
    const after = toWorld(zoomAt(cam, 2, at, VIEW, FLOOR), at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("never zooms out past the whole floor nor in past the maximum", () => {
    const cam = fit(VIEW, FLOOR);
    expect(zoomAt(cam, 0.1, { x: 0, y: 0 }, VIEW, FLOOR).scale).toBeCloseTo(cam.scale);
    expect(zoomAt(cam, 100, { x: 0, y: 0 }, VIEW, FLOOR).scale).toBe(MAX_SCALE);
  });

  it("a pan cannot drag the floor out of view", () => {
    const zoomed = zoomAt(fit(VIEW, FLOOR), 3, { x: 600, y: 350 }, VIEW, FLOOR);
    const far = pan(zoomed, { x: 100_000, y: 100_000 }, VIEW, FLOOR);
    expect(far.x).toBeLessThanOrEqual(-FLOOR.x * far.scale + 80);
    expect(far).toEqual(clamp(far, VIEW, FLOOR));
  });
});

const SHEET = { src: "/office/characters/scout_a.webp", cols: 6, rows: 12, cell: { w: 128, h: 192 }, feet: { x: 64, y: 180 }, scale: 0.85 };
const SIT = { ...SHEET, src: "/office/characters/scout_a_sit.webp", cols: 4, rows: 3 };
const pose = (over: Partial<AgentPose>): AgentPose => ({
  uid: "scout-1",
  role: "scout",
  sheet: "scout_a",
  pos: { x: 0, y: 0 },
  mode: "idle",
  facing: "down",
  flipped: false,
  frame: 0,
  carrying: false,
  ...over,
});

describe("frames", () => {
  const withSit: CharacterSheet = { id: "scout_a", main: SHEET, sit: SIT };
  const noSit: CharacterSheet = { id: "scout_a", main: SHEET, sit: null };

  it("reads the rig's track for mode and facing, wrapping the frame", () => {
    const pick = pickCell(pose({ mode: "walk", facing: "side", frame: 7 }), withSit);
    expect(pick.track).toEqual({ row: 5, frames: 6, fps: 10 });
    expect(pick.cell).toEqual({ x: 128, y: 5 * 192, w: 128, h: 192 });
  });

  it("sits on the seated sheet, or with the idle track without one", () => {
    expect(pickCell(pose({ mode: "sit", facing: "up" }), withSit).sheet.src).toBe(SIT.src);
    const fallback = pickCell(pose({ mode: "sit", facing: "up" }), noSit);
    expect(fallback.sheet.src).toBe(SHEET.src);
    expect(fallback.track.row).toBe(1);
  });

  it("a still track has one frame, and the feet are the anchor", () => {
    expect(cellRect(SHEET, { row: 0, frames: 1, fps: 0 }, 5).x).toBe(0);
    expect(feetAnchor(SHEET)).toEqual({ x: 0.5, y: 180 / 192 });
  });
});

describe("clicks", () => {
  it("an agent opens its page, a pile the positions", () => {
    expect(routeForClick({ kind: "agent", uid: "scorer-2", role: "scorer" })).toBe("/agents?agent=scorer");
    expect(routeForClick({ kind: "pile", dept: "scout" })).toBe("/positions");
  });
});

describe("allFurniture", () => {
  it("draws the free-standing furniture and the departments' desks, once per id", async () => {
    const { allFurniture } = await import("../layout-items");
    const item = (id: string) => ({ id, kind: "k", rect: FLOOR, blocking: true, image: null });
    const desk = (id: string) => ({ index: 0, furniture: item(id), seat: { x: 0, y: 0 }, seatFacing: "up" as const });
    const layout = {
      furniture: [item("printer"), item("scout_desk_0")],
      departments: [{ desks: [desk("scout_desk_0"), desk("scout_desk_1")] }],
    } as unknown as Parameters<typeof allFurniture>[0];
    expect(allFurniture(layout).map((f) => f.id)).toEqual(["printer", "scout_desk_0", "scout_desk_1"]);
  });
});
