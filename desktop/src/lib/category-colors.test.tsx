import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import PositionTypesPie from "@/app/components/PositionTypesPie";
import { aggregateRoleFamilies, groupRoleFamilies } from "@/lib/position-classifier";
import { applyCategoryPalette, categoryColor } from "@/lib/category-colors";
import { categoryPalette } from "@/lib/theme-palette";

// The variables --cat-0 … --cat-13 follow the theme: written from the main colour (--color-green) and the card, and written
// again when the theme changes. In jsdom a theme is the page's own variables set on the root.
const root = document.documentElement;
const setTheme = (accent: string, card: string, name = "x") => {
  root.style.setProperty("--color-green", accent);
  root.style.setProperty("--color-card", card);
  root.dataset.jhtTheme = name;
};
const written = () => {
  const css = document.getElementById("jht-category-palette")?.textContent ?? "";
  return Array.from(css.matchAll(/--cat-(\d+):(#[0-9a-f]{6})/g)).map((m) => m[2]);
};
const resolveFill = (fill: string) => {
  const index = Number(/--cat-(\d+)/.exec(fill)?.[1]);
  return written()[index];
};

beforeEach(() => setTheme("#ff9d6b", "#2d1523", "dusk"));
afterEach(() => {
  cleanup();
  root.style.removeProperty("--color-green");
  root.style.removeProperty("--color-card");
  delete root.dataset.jhtTheme;
  document.getElementById("jht-category-palette")?.remove();
});

const NAMES = ["Analytics Engineering", "Data Engineering", "Data Science & ML", "Data Analytics", "Platform Engineering", "Frontend", "Security", "Solutions"];
const rows = NAMES.flatMap((family, i) => Array.from({ length: 30 - i * 3 }, () => ({ role_family: family, score: 70, critic: null })));

describe("the page's category colours", () => {
  it("are written from the theme's main colour: the first one is the accent itself, the rest its shades", () => {
    expect(applyCategoryPalette()).toEqual(categoryPalette("#ff9d6b", "#2d1523"));
    expect(written()).toHaveLength(14);
    expect(written()[0]).toBe("#ff9d6b");
  });

  it("are written again when the theme changes, without the page asking: an orange theme, then a blue one", async () => {
    applyCategoryPalette();
    const orange = written();
    setTheme("#44d9e6", "#112b39", "ocean");
    await waitFor(() => expect(written()[0]).toBe("#44d9e6"));
    expect(written().filter((c) => orange.includes(c))).toEqual([]);
    setTheme("#2f6b3a", "#e9eee3", "sage");
    await waitFor(() => expect(written()[0]).toBe("#2f6b3a"));
  });

  it("are not written when the theme has no readable main colour (the charts keep their fallbacks)", () => {
    root.style.setProperty("--color-green", "not a colour");
    expect(applyCategoryPalette()).toBeNull();
    expect(document.getElementById("jht-category-palette")).toBeNull();
    expect(categoryColor(3)).toBe("var(--cat-3, color-mix(in srgb, var(--color-blue) 50%, var(--color-yellow)))");
  });

  it("make the TYPES card's donut, dots and bars all different, and different again in another theme", async () => {
    const draw = () => {
      const data = groupRoleFamilies(aggregateRoleFamilies(rows));
      const view = render(<PositionTypesPie data={data} title="TYPES" emptyLabel="-" size={190} />);
      const fills = Array.from(view.container.querySelectorAll("svg path")).map((p) => resolveFill(p.getAttribute("fill") ?? ""));
      view.unmount();
      return fills;
    };
    applyCategoryPalette();
    const orange = draw();
    expect(orange.length).toBeGreaterThanOrEqual(8);
    expect(orange.every((c) => /^#[0-9a-f]{6}$/.test(c ?? ""))).toBe(true);
    expect(new Set(orange).size).toBe(orange.length);
    setTheme("#44d9e6", "#112b39", "ocean");
    await waitFor(() => expect(written()[0]).toBe("#44d9e6"));
    const blue = draw();
    expect(new Set(blue).size).toBe(blue.length);
    // the same slices, other colours: nothing of the orange theme is left in the blue one
    expect(blue.filter((c) => orange.includes(c))).toEqual([]);
  });
});
