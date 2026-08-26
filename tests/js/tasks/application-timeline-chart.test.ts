import { describe, expect, it } from "vitest";
import {
  applicationTimelineBarLayout,
  applicationTimelineScale,
  projectTimelineY,
} from "@/lib/application-timeline-chart";

describe("scala divergente della timeline candidature", () => {
  const points = [
    {
      date: "2026-08-24",
      count: 7,
      submitted: 7,
      accepted: 2,
      rejected: 3,
    },
  ];

  it("espone tick negativi e positivi con la stessa unità", () => {
    const scale = applicationTimelineScale(points);
    expect(scale.maxMagnitude).toBe(10);
    expect(scale.ticks).toEqual([-10, -5, 0, 5, 10]);
  });

  it("proietta i rifiuti sotto lo zero e gli altri eventi sopra", () => {
    const scale = applicationTimelineScale(points);
    const zero = projectTimelineY(0, scale, 10, 200);
    const accepted = projectTimelineY(2, scale, 10, 200);
    const rejected = projectTimelineY(-3, scale, 10, 200);

    expect(zero).toBe(110);
    expect(accepted).toBeLessThan(zero);
    expect(rejected).toBeGreaterThan(zero);
    expect(projectTimelineY(10, scale, 10, 200)).toBe(10);
    expect(projectTimelineY(-10, scale, 10, 200)).toBe(210);
  });
});

describe("layout a barre della timeline candidature", () => {
  it("riserva uno slot per giorno e contiene le tre barre nel gruppo", () => {
    const layout = applicationTimelineBarLayout(30, 900);

    expect(layout.slotWidth).toBe(30);
    expect(layout.groupWidth).toBeLessThan(layout.slotWidth);
    expect(layout.barWidth * 3 + layout.gap * 2).toBeCloseTo(layout.groupWidth);
  });

  it("resta valido con un solo giorno", () => {
    const layout = applicationTimelineBarLayout(1, 900);

    expect(layout.slotWidth).toBe(900);
    expect(layout.groupWidth).toBe(34);
    expect(layout.barWidth).toBeGreaterThan(0);
  });
});
