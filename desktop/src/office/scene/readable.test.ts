import { describe, expect, it } from "vitest";
import { READABLE_PX, readableScale } from "./readable";

describe("readableScale", () => {
  it("grows a label the camera would shrink below the readable size, to exactly that size", () => {
    // a 10 px handoff tag at the minimum zoom of a window about a thousand pixels wide
    const s = readableScale(10, 0.32, READABLE_PX.handoffTag);
    expect(s).toBeGreaterThan(1);
    expect(10 * 0.32 * s).toBeCloseTo(READABLE_PX.handoffTag);
  });

  it("leaves a label at its own size where it is already readable (zoomed in)", () => {
    expect(readableScale(10, 2.8, READABLE_PX.handoffTag)).toBe(1);
    expect(readableScale(26, 1, 10)).toBe(1);
  });

  it("does nothing with a size or a scale it cannot use", () => {
    expect(readableScale(0, 0.3, 10)).toBe(1);
    expect(readableScale(10, 0, 10)).toBe(1);
    expect(readableScale(10, Number.NaN, 10)).toBe(1);
  });
});
