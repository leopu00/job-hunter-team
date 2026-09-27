import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OfficeClick, OfficeLayout, Rect } from "../contract";
import { hitTest, keyboardTargets, layoutHits, rectOf, sameTarget, type Hit } from "./hit";

const r = (x: number, y: number, w = 100, h = 100): Rect => ({ x, y, w, h });
const item = (id: string, kind: string, rect: Rect) => ({ id, kind, rect, blocking: true, image: null });

const LAYOUT = {
  furniture: [
    item("handoff_scout", "handoff_table", r(1000, 700, 190, 60)),
    item("wb_scrittori", "nc_whiteboard", r(290, 1160, 150, 34)),
    item("output_shelf", "output_shelf", r(1395, 1908, 170, 64)),
    item("printer", "printer", r(1218, 185, 95, 70)),
    item("corkboard", "corkboard", r(2990, 865, 150, 34)),
    item("hologram", "hologram", r(675, 435, 200, 180)),
    item("plant_a", "plant", r(50, 50, 20, 20)),
  ],
  departments: [{ id: "scout", zone: r(320, 348, 880, 520) }],
} as unknown as OfficeLayout;

const agent = (uid: string, rect: Rect): Hit => ({ rect, target: { kind: "agent", uid, role: "scout" } });

describe("layoutHits", () => {
  it("maps the layout's objects to what they open, and ignores the rest", () => {
    const { tables, objects, zones } = layoutHits(LAYOUT);
    expect(tables.map((h) => h.target)).toEqual([{ kind: "pile", dept: "scout" }]);
    expect(objects.map((h) => h.target)).toEqual([
      { kind: "department", dept: "scrittori" },
      { kind: "shelf" },
      { kind: "printer" },
      { kind: "board" },
      { kind: "hologram" },
    ]);
    expect(zones.map((h) => h.target)).toEqual([{ kind: "department", dept: "scout" }]);
  });

  it("the real layout has every object D07 opens (a renamed kind would lose its panel)", () => {
    const layout = JSON.parse(readFileSync(join(__dirname, "../../../public/office/layout.json"), "utf8")) as OfficeLayout;
    const { tables, objects, zones } = layoutHits(layout);
    const kinds = new Set(objects.map((h) => h.target.kind));
    for (const k of ["shelf", "printer", "board", "hologram", "department"]) expect(kinds, k).toContain(k);
    expect(tables.map((h) => (h.target as { dept: string }).dept).sort()).toEqual(["analisti", "scorer", "scout", "scrittori"]);
    expect(zones).toHaveLength(5);
  });
});

describe("hitTest (the Godot office's order)", () => {
  const fixed = layoutHits(LAYOUT);
  const pile: Hit = { rect: r(1040, 640, 80, 70), target: { kind: "pile", dept: "scout" } };

  it("an agent before a pile, a pile before its table, a table before the zone", () => {
    const at = { x: 1060, y: 690 };
    expect(hitTest(at, { agents: [agent("scout-1", r(1030, 600, 60, 120))], piles: [pile], ...fixed })).toEqual({ kind: "agent", uid: "scout-1", role: "scout" });
    expect(hitTest(at, { agents: [], piles: [pile], ...fixed })).toEqual({ kind: "pile", dept: "scout" });
    expect(hitTest({ x: 1150, y: 750 }, { agents: [], piles: [], ...fixed })).toEqual({ kind: "pile", dept: "scout" });
    expect(hitTest({ x: 400, y: 400 }, { agents: [], piles: [], ...fixed })).toEqual({ kind: "department", dept: "scout" });
    expect(hitTest({ x: 60, y: 60 }, { agents: [], piles: [], ...fixed })).toBeNull();
  });

  it("an object inside a zone is the object, not the department", () => {
    expect(hitTest({ x: 700, y: 500 }, { agents: [], piles: [], ...fixed })).toEqual({ kind: "hologram" });
  });

  it("of two agents under the pointer, the one drawn in front", () => {
    const back = agent("scout-1", r(500, 500, 60, 120));
    const front = agent("scout-2", r(520, 540, 60, 120));
    expect((hitTest({ x: 540, y: 600 }, { agents: [front, back], piles: [], tables: [], objects: [], zones: [] }) as { uid: string }).uid).toBe("scout-2");
  });

  it("sameTarget compares what, not which object", () => {
    const a: OfficeClick = { kind: "pile", dept: "scout" };
    expect(sameTarget(a, { kind: "pile", dept: "scout" })).toBe(true);
    expect(sameTarget(a, null)).toBe(false);
  });
});

describe("the keyboard's targets (D08)", () => {
  const fixed = layoutHits(LAYOUT);
  it("a department is its zone, a pile its sheets or else its table, an agent that left is nowhere", () => {
    const layers = { agents: [agent("scout-1", r(1, 2, 3, 4))], piles: [], ...fixed };
    expect(rectOf({ kind: "department", dept: "scout" }, layers)).toEqual(r(320, 348, 880, 520));
    expect(rectOf({ kind: "pile", dept: "scout" }, layers)).toEqual(r(1000, 700, 190, 60));
    expect(rectOf({ kind: "pile", dept: "scout" }, { ...layers, piles: [{ rect: r(9, 9, 9, 9), target: { kind: "pile", dept: "scout" } }] })).toEqual(r(9, 9, 9, 9));
    expect(rectOf({ kind: "agent", uid: "scout-1", role: "scout" }, layers)).toEqual(r(1, 2, 3, 4));
    expect(rectOf({ kind: "agent", uid: "scout-9", role: "scout" }, layers)).toBeNull();
    expect(rectOf({ kind: "board" }, layers)).toEqual(r(2990, 865, 150, 34));
  });

  it("a department with a zone and a whiteboard is rung around its zone", () => {
    const dept = { kind: "department", dept: "scrittori" } as const;
    const zone = r(320, 1520, 860, 440);
    const board = r(290, 1160, 150, 34);
    expect(rectOf(dept, { agents: [], piles: [], tables: [], objects: [{ rect: board, target: dept }], zones: [{ rect: zone, target: dept }] })).toEqual(zone);
  });

  it("reading order: agents, piles, departments, then the objects the layout has", () => {
    expect(keyboardTargets([{ uid: "capitano", role: "capitano" }, { uid: "scout-1", role: "scout" }], LAYOUT)).toEqual([
      { kind: "agent", uid: "capitano", role: "capitano" },
      { kind: "agent", uid: "scout-1", role: "scout" },
      { kind: "pile", dept: "scout" },
      { kind: "department", dept: "scout" },
      { kind: "shelf" },
      { kind: "printer" },
      { kind: "board" },
      { kind: "hologram" },
    ]);
  });
});
