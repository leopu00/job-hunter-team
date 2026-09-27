import { describe, expect, it } from "vitest";

import { NavGrid, distance, grow, hasPoint } from "./nav-grid";

const floor = { x: 0, y: 0, w: 320, h: 320 };

function grid(obstacles = [] as { x: number; y: number; w: number; h: number }[], walls = [] as typeof obstacles) {
  return new NavGrid({ floor, obstacles, walls, cell: 32, margin: 28, wallMargin: 14 });
}

describe("NavGrid (nav_grid.gd)", () => {
  it("reads Godot's Rect2: start edges inside, end edges outside, grow on every side", () => {
    const r = { x: 10, y: 10, w: 20, h: 20 };
    expect(hasPoint(r, { x: 10, y: 10 })).toBe(true);
    expect(hasPoint(r, { x: 30, y: 20 })).toBe(false);
    expect(grow(r, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 });
  });

  it("blocks the cells whose centre falls in an obstacle grown by the margin, walls by the wall margin", () => {
    const empty = grid();
    expect(empty.cols).toBe(10);
    expect(empty.pointCount).toBe(100);
    // A 4 px box at (150, 150): grown by 28 (122..182) it covers the centres 144 and 176 → 2x2 cells.
    expect(grid([{ x: 150, y: 150, w: 4, h: 4 }]).pointCount).toBe(96);
    // The same box as a wall grows by 14 only (136..168): the centre 144 → 1 cell.
    expect(grid([], [{ x: 150, y: 150, w: 4, h: 4 }]).pointCount).toBe(99);
  });

  it("walks around an obstacle, never through its margin, and ends exactly on a walkable target", () => {
    const g = grid([{ x: 100, y: 0, w: 40, h: 250 }]);
    const route = g.path({ x: 16, y: 16 }, { x: 300, y: 20 });
    expect(route.length).toBeGreaterThan(2);
    expect(route.at(-1)).toEqual({ x: 300, y: 20 });
    for (const p of route.slice(0, -1)) expect(g.isPointWalkable(p)).toBe(true);
    // The obstacle reaches y=250 (grown: 278): the route must go under it.
    expect(Math.max(...route.map((p) => p.y))).toBeGreaterThan(278);
  });

  it("never cuts a corner: a diagonal step needs both orthogonal cells free", () => {
    // One blocked cell at column 1, row 0 (centre 48,16).
    const g = new NavGrid({ floor, obstacles: [], walls: [{ x: 47, y: 15, w: 2, h: 2 }], cell: 32, margin: 0, wallMargin: 0 });
    const route = g.path({ x: 16, y: 16 }, { x: 80, y: 48 });
    // From (16,16) to (80,48) the diagonal through (48,16)'s corner is forbidden.
    for (let i = 1; i < route.length; i++) {
      const step = distance(route[i - 1]!, route[i]!);
      const diagonal = Math.abs(route[i]!.x - route[i - 1]!.x) > 0 && Math.abs(route[i]!.y - route[i - 1]!.y) > 0;
      if (diagonal && route[i - 1]!.y === 16) expect(route[i - 1]!.x).not.toBe(16);
      expect(step).toBeLessThanOrEqual(Math.hypot(32, 32) + 1e-9);
    }
  });

  it("has no path through a wall with no gap, and clamps an unwalkable target to its closest cell", () => {
    const g = grid([], [{ x: 158, y: 0, w: 4, h: 320 }]);
    expect(g.path({ x: 16, y: 16 }, { x: 300, y: 300 })).toEqual([]);
    const open = grid([{ x: 150, y: 150, w: 20, h: 20 }]);
    const end = open.path({ x: 16, y: 16 }, { x: 160, y: 160 }).at(-1)!;
    expect(open.isPointWalkable(end)).toBe(true);
  });

  it("is deterministic: the same inputs give the same route", () => {
    const g = grid([{ x: 100, y: 60, w: 40, h: 200 }]);
    expect(g.path({ x: 16, y: 16 }, { x: 300, y: 300 })).toEqual(g.path({ x: 16, y: 16 }, { x: 300, y: 300 }));
  });
});
