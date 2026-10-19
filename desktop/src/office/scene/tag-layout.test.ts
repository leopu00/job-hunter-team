import { describe, expect, it } from "vitest";
import { separateTags, type TagBox } from "./tag-layout";

const box = (id: string, x: number, y: number, w = 100, h = 20): TagBox => ({ id, x, y, w, h });
const rectOf = (t: TagBox, y: number) => ({ top: y - t.h / 2, bottom: y + t.h / 2, left: t.x - t.w / 2, right: t.x + t.w / 2 });

describe("separateTags", () => {
  it("leaves alone tags that do not touch", () => {
    const out = separateTags([box("a", 0, 0), box("b", 300, 0)], [], 4);
    expect(out.get("a")?.y).toBe(0);
    expect(out.get("b")?.y).toBe(0);
  });

  it("moves the upper of two touching tags just above the lower, which stays over its agent", () => {
    const lower = box("scrittore-2", 10, 50);
    const upper = box("scrittore-1", 0, 40);
    const out = separateTags([upper, lower], [], 4);
    expect(out.get("scrittore-2")?.y).toBe(50);
    const a = rectOf(upper, out.get("scrittore-1")!.y);
    const b = rectOf(lower, out.get("scrittore-2")!.y);
    expect(a.bottom + 4).toBeLessThanOrEqual(b.top + 1e-9);
  });

  it("goes above a fixed label in the way, and a stack of three ends with no overlap", () => {
    const out = separateTags([box("a", 0, 100), box("b", 0, 95), box("c", 0, 90)], [{ x: -60, y: 85, w: 120, h: 30 }], 2);
    const ys = ["a", "b", "c"].map((id) => out.get(id)!.y);
    // all above the fixed label (top at 85), each above the next
    for (const y of ys) expect(y + 10).toBeLessThanOrEqual(85 - 2 + 1e-9);
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
  });

  it("keeps a tag inside the top and the sides of the view", () => {
    expect(separateTags([box("a", 0, 5)], [], 4, { top: 0 }).get("a")).toEqual({ x: 0, y: 10 });
    expect(separateTags([box("a", 10, 50)], [], 4, { left: 0, right: 500 }).get("a")).toEqual({ x: 50, y: 50 });
    expect(separateTags([box("a", 480, 50)], [], 4, { left: 0, right: 500 }).get("a")).toEqual({ x: 450, y: 50 });
  });
});
