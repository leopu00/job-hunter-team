import { describe, expect, it } from "vitest";
import {
  COLUMN_TIER_HIDE_CLASS,
  COLUMN_TIER_MIN_VIEWPORT,
  DEFAULT_POSITIONS_COLUMNS,
  isDefaultColumnSet,
  tierColumns,
  tierMinWidth,
  tierWidthPercent,
} from "../../../../web/app/(protected)/positions/columns";

// The default columns of Posizioni show up in three tiers by window width, so
// that Score and Stato are on screen without a horizontal scroll under ~1200 px.
// The body is zoomed 1.15 and the page chrome takes ~111 real px, so the table
// container is (viewport − 111) / 1.15 CSS px.
const room = (viewport: number) => (viewport - 111) / 1.15;

describe("Posizioni default column tiers", () => {
  it("fits the narrowest tier in a 1068 px window, with Score and Stato in it", () => {
    const cols = tierColumns(DEFAULT_POSITIONS_COLUMNS, "a");
    expect(cols).toContain("score");
    expect(cols).toContain("status");
    expect(tierMinWidth(DEFAULT_POSITIONS_COLUMNS, "a")).toBeLessThanOrEqual(room(1068));
  });

  it("fits each wider tier from the viewport where it appears", () => {
    expect(tierMinWidth(DEFAULT_POSITIONS_COLUMNS, "b")).toBeLessThanOrEqual(
      room(COLUMN_TIER_MIN_VIEWPORT.b),
    );
    expect(tierMinWidth(DEFAULT_POSITIONS_COLUMNS, "c")).toBeLessThanOrEqual(
      room(COLUMN_TIER_MIN_VIEWPORT.c),
    );
  });

  it("ends with the eight default columns, as before, and grows tier by tier", () => {
    expect(tierColumns(DEFAULT_POSITIONS_COLUMNS, "c")).toEqual(DEFAULT_POSITIONS_COLUMNS);
    const a = tierColumns(DEFAULT_POSITIONS_COLUMNS, "a").length;
    const b = tierColumns(DEFAULT_POSITIONS_COLUMNS, "b").length;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(DEFAULT_POSITIONS_COLUMNS.length);
  });

  it("gives every visible column of a tier a width, and the widths add up to 100%", () => {
    for (const tier of ["a", "b", "c"] as const) {
      const sum = tierColumns(DEFAULT_POSITIONS_COLUMNS, tier)
        .map((c) => parseFloat(tierWidthPercent(c, DEFAULT_POSITIONS_COLUMNS, tier)))
        .reduce((x, y) => x + y, 0);
      expect(sum).toBeCloseTo(100, 1);
    }
  });

  it("only treats exactly the default set as responsive", () => {
    expect(isDefaultColumnSet(new Set(DEFAULT_POSITIONS_COLUMNS))).toBe(true);
    expect(isDefaultColumnSet(new Set(DEFAULT_POSITIONS_COLUMNS.slice(1)))).toBe(false);
    expect(isDefaultColumnSet(new Set([...DEFAULT_POSITIONS_COLUMNS, "source" as never]))).toBe(false);
  });

  it("hides a tier exactly under the viewport where it appears (Tailwind 4: max-[N] is width < N)", () => {
    expect(COLUMN_TIER_HIDE_CLASS.b).toBe(`max-[${COLUMN_TIER_MIN_VIEWPORT.b}px]:hidden`);
    expect(COLUMN_TIER_HIDE_CLASS.c).toBe(`max-[${COLUMN_TIER_MIN_VIEWPORT.c}px]:hidden`);
  });
});
