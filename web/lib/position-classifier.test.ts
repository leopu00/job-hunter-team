import { describe, expect, it } from "vitest";
import {
  FAMILY_PALETTE,
  OTHER_GROUP_LABEL,
  UNCATEGORIZED_LABEL,
  aggregateRoleFamilies,
  assignFamilyColors,
  colorForFamily,
  groupRoleFamilies,
} from "./position-classifier";

// ── gli elementi del donut «Types» ─────────────────────────────────────────────────────────────────────────────
const NAMES = [
  "Analytics Engineering",
  "Data Engineering",
  "Agentic AI / LLM Engineering",
  "MLOps / ML Engineering",
  "Platform Engineering",
  "Forward Deployed Engineering",
  "AI Product Engineering",
  "Applied AI Engineering",
  "QA / Test Automation",
  "Business Process Automation",
  "Frontend Engineering",
  "Solutions Engineering",
  "Security Engineering",
  "Data Science",
  "Technical Writing",
];

const rowsFor = (families: string[], each = 5) =>
  families.flatMap((family, i) =>
    Array.from({ length: each + families.length - i }, () => ({ role_family: family, score: 70, critic: null })),
  );

const donutFor = (families: string[]) => groupRoleFamilies(aggregateRoleFamilies(rowsFor(families)));

describe("the colours of the position types", () => {
  it("are the theme's variables (--cat-N, written from the theme's main colour), never a fixed hex or hsl value", () => {
    const cat = /^var\(--cat-\d{1,2}, (var\(--color-[a-z-]+\)|color-mix\(in srgb, var\(--color-[a-z-]+\) \d+%, var\(--color-[a-z-]+\)\))\)$/;
    for (const entry of FAMILY_PALETTE) expect(entry).toMatch(cat);
    for (const name of NAMES) expect(FAMILY_PALETTE).toContain(colorForFamily(name));
    for (const slice of donutFor(NAMES)) expect(slice.color).toMatch(/^var\(--/);
  });

  it("have at least eight different entries before any repeats", () => {
    expect(new Set(FAMILY_PALETTE).size).toBe(FAMILY_PALETTE.length);
    expect(FAMILY_PALETTE.length).toBeGreaterThanOrEqual(8);
  });

  it("keep Analytics Engineering and Data Engineering apart (both were the same pink)", () => {
    const slices = donutFor(["Analytics Engineering", "Data Engineering", "Frontend Engineering"]);
    const color = (family: string) => slices.find((s) => s.family === family)?.color;
    expect(color("Analytics Engineering")).toBeDefined();
    expect(color("Analytics Engineering")).not.toBe(color("Data Engineering"));
  });

  it("give every visible slice its own colour, whatever the set of types", () => {
    // Every size of set, from a few types to more than the donut can show, in a few different mixes.
    for (let size = 1; size <= NAMES.length; size++) {
      for (let shift = 0; shift < NAMES.length; shift++) {
        const families = Array.from({ length: size }, (_, i) => NAMES[(i + shift) % NAMES.length]);
        const slices = donutFor(Array.from(new Set(families)));
        const colors = slices.map((s) => s.color);
        expect(new Set(colors).size, `${slices.map((s) => s.family).join(" | ")}`).toBe(colors.length);
      }
    }
  });

  it("keep «Other» (the long tail) and «Da categorizzare» apart from each other and from every type", () => {
    // «Da categorizzare» big enough to be a slice of its own, the long tail of small types behind it.
    const rows = [
      ...rowsFor(NAMES),
      ...Array.from({ length: 400 }, () => ({ role_family: UNCATEGORIZED_LABEL, score: null, critic: null })),
    ];
    const slices = groupRoleFamilies(aggregateRoleFamilies(rows));
    expect(slices.some((s) => s.family === OTHER_GROUP_LABEL)).toBe(true);
    expect(slices.some((s) => s.family === UNCATEGORIZED_LABEL)).toBe(true);
    const colors = slices.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("give the whole list of types its own colours too (the map's donut shows them all)", () => {
    const first = aggregateRoleFamilies(rowsFor(NAMES.slice(0, FAMILY_PALETTE.length))).map((d) => d.color);
    expect(new Set(first).size).toBe(first.length);
    // Past the palette it repeats, in order: no colour is used a third time before all are used twice.
    const all = assignFamilyColors(NAMES);
    const uses = FAMILY_PALETTE.map((c) => Array.from(all.values()).filter((v) => v === c).length);
    expect(Math.max(...uses) - Math.min(...uses)).toBeLessThanOrEqual(1);
  });

  it("go in the order the types come, biggest first: the first is the theme's main colour, the next ones its variants", () => {
    const colors = assignFamilyColors(NAMES.slice(0, 9));
    expect(colors.get(NAMES[0])).toBe(FAMILY_PALETTE[0]);
    expect(colors.get(NAMES[1])).toBe(FAMILY_PALETTE[1]);
    // the same names the other way round take the colours the other way round: the order is what decides
    const reversed = assignFamilyColors([...NAMES.slice(0, 9)].reverse());
    expect(reversed.get(NAMES[8])).toBe(FAMILY_PALETTE[0]);
    // and the donut's biggest slice is the main colour of the theme
    const slices = donutFor(NAMES.slice(0, 5));
    expect(slices[0].color).toBe(FAMILY_PALETTE[0]);
    expect(slices.map((s) => s.color)).toEqual(FAMILY_PALETTE.slice(0, 5));
  });
});
