import { describe, expect, it } from "vitest";
import { overviewMaxZoom } from "@/lib/globe-viewport";

const EUROPE: [[number, number], [number, number]] = [[-6, 36], [30, 60]];
const ONE_COUNTRY: [[number, number], [number, number]] = [[6, 45.5], [12, 47.5]];

/** Radius of the sphere on screen, px, at a zoom (512 px world tiles). */
const radiusAt = (zoom: number) => (512 * 2 ** zoom) / (2 * Math.PI);

describe("overviewMaxZoom", () => {
  it("shows the edge of the globe on both sides when the pins span several countries", () => {
    const view = { width: 929, height: 570 };
    const zoom = overviewMaxZoom(EUROPE, view, 12);
    // The sphere is narrower than the map: its edge is on screen left and right.
    expect(radiusAt(zoom) * 2).toBeLessThan(view.width);
    // ...and not so small that the beams run into each other.
    expect(radiusAt(zoom) * 2).toBeGreaterThan(view.width * 0.7);
  });

  it("lets a bigger window come closer, with the same share of the sphere on screen", () => {
    const small = overviewMaxZoom(EUROPE, { width: 1068, height: 650 }, 12);
    const big = overviewMaxZoom(EUROPE, { width: 2000, height: 1100 }, 12);
    expect(big).toBeGreaterThan(small);
  });

  it("does not hold back a set that lives in one country", () => {
    expect(overviewMaxZoom(ONE_COUNTRY, { width: 1068, height: 650 }, 12)).toBe(12);
    expect(overviewMaxZoom(ONE_COUNTRY, { width: 1068, height: 650 }, 7)).toBe(7);
  });

  it("never goes above the zoom the caller allows", () => {
    expect(overviewMaxZoom(EUROPE, { width: 20000, height: 12000 }, 3)).toBe(3);
  });

  it("leaves the caller's zoom alone while the map has no size yet", () => {
    expect(overviewMaxZoom(EUROPE, { width: 0, height: 0 }, 12)).toBe(12);
    // A container whose size cannot be read must not turn the zoom into NaN.
    expect(overviewMaxZoom(EUROPE, { width: NaN, height: NaN }, 12)).toBe(12);
  });
});
