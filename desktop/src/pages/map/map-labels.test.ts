import { describe, expect, it } from "vitest";
import {
  estimateTextWidth,
  groupLabel,
  labelFontSize,
  labelRect,
  nameRect,
  overlapArea,
  placeLabels,
  styleValueAtZoom,
  type LabelItem,
  type Rect,
} from "@/lib/globe-label-placement";

const SIZE = 12;
const item = (id: string, x: number, y: number, text: string, priority = 1): LabelItem => ({
  id,
  x,
  y,
  w: estimateTextWidth(text, SIZE),
  h: Math.ceil(SIZE * 1.3),
  priority,
});

/** Nothing the function placed may touch another placed label or an obstacle (unless flagged). */
function expectNoCollision(items: LabelItem[], obstacles: Rect[], size = SIZE) {
  const placed = placeLabels(items, obstacles, size);
  const rects = [...placed.entries()];
  for (const [id, p] of rects) {
    expect(p.collides, `${id} flagged as colliding`).toBe(false);
    for (const o of obstacles) expect(overlapArea(p.rect, o), `${id} on an obstacle`).toBe(0);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      expect(overlapArea(rects[i][1].rect, rects[j][1].rect), `${rects[i][0]} on ${rects[j][0]}`).toBe(0);
  return placed;
}

describe("placeLabels", () => {
  it("keeps the label under the pin when nothing is there", () => {
    const placed = expectNoCollision([item("a", 200, 200, "3")], []);
    expect(placed.get("a")!.anchor).toBe("top");
  });

  it("moves a label away from a country name written right under its pin (IRELAND3)", () => {
    const pin = item("ie", 300, 300, "3");
    // «IRELAND» centred just under the pin: where the default label would go.
    const name = nameRect({ x: 300, y: 300 + 20 }, "IRELAND");
    expect(overlapArea(labelRect("top", pin, SIZE), name)).toBeGreaterThan(0);
    const placed = expectNoCollision([pin], [name]);
    expect(placed.get("ie")!.anchor).not.toBe("top");
  });

  it("separates two labels that would sit on each other (HUNGARY: «4 remote» over «3»)", () => {
    const placed = expectNoCollision(
      [item("remote", 500, 400, "4 remote", 4), item("city", 505, 404, "3", 3)],
      [],
    );
    // The bigger group keeps the default side, the other one yields: its
    // pin is 4 px from the first one, only the side above is clear.
    expect(placed.get("remote")!.anchor).toBe("top");
    expect(placed.get("city")!.anchor).toBe("bottom");
  });

  it("does not depend on the order the labels come in", () => {
    const items = [item("a", 100, 100, "12", 12), item("b", 104, 102, "3", 3), item("c", 98, 99, "7", 7)];
    const one = placeLabels(items, [], SIZE);
    const two = placeLabels([...items].reverse(), [], SIZE);
    for (const it of items) expect(one.get(it.id)).toEqual(two.get(it.id));
  });

  it("keeps every label, and flags the one that has no free side", () => {
    // Obstacles on all three sides of the pin: it still gets a place, flagged.
    const pin = item("x", 300, 300, "3");
    const wall: Rect[] = [{ x: 0, y: 0, w: 1000, h: 1000 }];
    const placed = placeLabels([pin], wall, SIZE);
    expect(placed.size).toBe(1);
    expect(placed.get("x")!.collides).toBe(true);
  });

  it("moves a label far from its pin, with a guide line, when no side next to the pin is free", () => {
    const pin = item("hu", 500, 400, "3");
    // Names all around the pin: every side next to it is taken.
    const around = (["top", "left", "right", "bottom"] as const).map((a) => {
      const r = labelRect(a, pin, SIZE);
      return { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 };
    });
    const placed = expectNoCollision([pin], around);
    const p = placed.get("hu")!;
    expect(p.anchor).toBe("center");
    expect(p.leader).not.toBeNull();
    // The text is clear of the pin itself, so the line has something to join.
    const pinRect = { x: 499, y: 399, w: 2, h: 2 };
    expect(overlapArea(p.rect, pinRect)).toBe(0);
    expect(Math.hypot(p.leader!.dx, p.leader!.dy)).toBeGreaterThan(pin.w / 2);
  });

  it("does not use a guide line while a side next to the pin is free", () => {
    const placed = placeLabels([item("a", 200, 200, "3")], [], SIZE);
    expect(placed.get("a")!.leader).toBeNull();
  });

  it("with the old fixed «below the pin» placement the same scene collides", () => {
    const a = item("a", 500, 400, "4 remote", 4);
    const b = item("b", 505, 404, "3", 3);
    expect(overlapArea(labelRect("top", a, SIZE), labelRect("top", b, SIZE))).toBeGreaterThan(0);
  });
});

describe("label measures", () => {
  it("grows with the zoom like the layer's text-size", () => {
    expect(labelFontSize(0)).toBe(11);
    expect(labelFontSize(6)).toBe(12);
    expect(labelFontSize(12)).toBe(14);
    expect(labelFontSize(20)).toBe(14);
    expect(labelFontSize(3)).toBeGreaterThan(11);
  });

  it("makes a country name wider than a place name of the same length", () => {
    expect(nameRect({ x: 0, y: 0 }, "POLAND").w).toBeGreaterThan(nameRect({ x: 0, y: 0 }, "POLAND", 12, false).w);
  });
});

describe("name boxes", () => {
  it("wraps a long country name as the map does, so the box is taller", () => {
    const one = nameRect({ x: 0, y: 0 }, "IRELAND", 11, true, 6);
    const two = nameRect({ x: 0, y: 0 }, "UNITED KINGDOM", 11, true, 6);
    expect(two.h).toBeGreaterThan(one.h);
    // The widest line, not the whole name.
    expect(two.w).toBeLessThan(nameRect({ x: 0, y: 0 }, "UNITED KINGDOM", 11, true, 20).w);
  });
});

describe("styleValueAtZoom", () => {
  const stops = { stops: [[3, 10], [5, 12], [8, 14]] };
  it("reads a fixed value as it is", () => {
    expect(styleValueAtZoom(12, 4, 16)).toBe(12);
    expect(styleValueAtZoom("uppercase", 4, "none")).toBe("uppercase");
  });

  it("interpolates a zoom function between its stops and holds the ends", () => {
    expect(styleValueAtZoom(stops, 4, 0)).toBe(11);
    expect(styleValueAtZoom(stops, 1, 0)).toBe(10);
    expect(styleValueAtZoom(stops, 20, 0)).toBe(14);
  });

  it("steps a function of strings and falls back on what it does not understand", () => {
    const t = { stops: [[8, "none"], [12, "uppercase"]] };
    expect(styleValueAtZoom(t, 10, "x")).toBe("none");
    expect(styleValueAtZoom(undefined, 4, 16)).toBe(16);
    expect(styleValueAtZoom({ stops: [] }, 4, 16)).toBe(16);
  });
});

describe("groupLabel", () => {
  it("writes nothing for one position, the count for a group", () => {
    expect(groupLabel(1, false, "remote")).toBe("");
    expect(groupLabel(1, true, "remote")).toBe("");
    expect(groupLabel(9, false, "remote")).toBe("9");
  });

  it("writes «N remote» for a group of remote positions, without a separator that splits it in two", () => {
    expect(groupLabel(2, true, "remote")).toBe("2 remote");
    expect(groupLabel(3, true, "da remoto")).toBe("3 da remoto");
    expect(groupLabel(4, true, "remote")).not.toContain("·");
  });
});
