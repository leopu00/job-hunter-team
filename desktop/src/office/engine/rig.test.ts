import { describe, expect, it } from "vitest";

import { effectiveMode, frameAt, startsGait, trackFor, walkFpsForSpeed } from "./rig";

describe("the sprite rig's timing (sprite_sheet_rig.gd)", () => {
  it("ties the walk cadence to the body's speed, between the track's fps and 24", () => {
    expect(walkFpsForSpeed(10, 150)).toBe(20);
    expect(walkFpsForSpeed(10, 185)).toBe(24);
    expect(walkFpsForSpeed(10, 40)).toBe(10);
    expect(walkFpsForSpeed(0, 150)).toBe(0);
  });

  it("degrades sit to work without a seated sheet, and unknown modes to idle", () => {
    expect(effectiveMode("sit", true)).toBe("sit");
    expect(effectiveMode("sit", false)).toBe("work");
    expect(effectiveMode("carry", false)).toBe("carry");
  });

  it("reads the tracks of the contract, the seated sheet for sit, the still frame for sit_idle", () => {
    expect(trackFor("walk", "side")).toEqual({ row: 5, frames: 6, fps: 10 });
    expect(trackFor("sit", "up")).toEqual({ row: 1, frames: 4, fps: 8 });
    expect(trackFor("sit", "up", true)).toEqual({ row: 1, frames: 1, fps: 0 });
  });

  it("counts frames at the track's fps and wraps; a still track stays on frame 0", () => {
    const walk = trackFor("walk", "down");
    expect(frameAt(walk, 0.55, 10)).toBe(5);
    expect(frameAt(walk, 0.65, 10)).toBe(0);
    expect(frameAt(trackFor("still", "down"), 3, 0)).toBe(0);
  });

  it("restarts the gait only when a walk or carry begins", () => {
    expect(startsGait("sit", "walk")).toBe(true);
    expect(startsGait("walk", "carry")).toBe(false);
    expect(startsGait("walk", "idle")).toBe(false);
  });
});
