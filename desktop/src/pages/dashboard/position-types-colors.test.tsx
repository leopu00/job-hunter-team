import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PositionTypesPie from "@/app/components/PositionTypesPie";
import { aggregateRoleFamilies, groupRoleFamilies } from "@/lib/position-classifier";

// The Dashboard's TYPES card (PositionTypesPie, the web's own component): the donut, the dots and the bars of the
// legend take the colours of the CHOSEN theme, and two visible types never share one (Analytics Engineering and
// Data Engineering were both the same pink).
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
];
const rows = NAMES.flatMap((family, i) =>
  Array.from({ length: 60 - i * 4 }, () => ({ role_family: family, score: 70, critic: null })),
);

function renderCard() {
  const data = groupRoleFamilies(aggregateRoleFamilies(rows));
  const view = render(<PositionTypesPie data={data} title="TYPES" emptyLabel="-" size={190} />);
  return { data, view };
}

// a type is a slot of the theme's palette; «Altre» (the long tail) and «Da categorizzare» are the two neutral greys
const isThemeColor = (value: string) => /^var\(--cat-\d{1,2}, /.test(value) || ["var(--color-muted)", "var(--color-dim)"].includes(value);

describe("the TYPES card of the Dashboard", () => {
  it("paints the donut, the dots and the bars with tokens of the theme, one colour for each visible type", () => {
    const { data, view } = renderCard();
    const slices = Array.from(view.container.querySelectorAll("svg path")).map((p) => p.getAttribute("fill") ?? "");
    const rowsEl = Array.from(view.container.querySelectorAll("ul li")).slice(1); // the first one is the column header
    const dots = rowsEl.map((li) => (li.querySelector("span.rounded-sm") as HTMLElement).style.background);
    const bars = rowsEl.map((li) => (li.querySelector("span.rounded-full > span") as HTMLElement).style.background);

    expect(data.length).toBeGreaterThanOrEqual(9);
    for (const list of [slices, dots, bars]) {
      expect(list).toHaveLength(data.length);
      for (const color of list) expect(isThemeColor(color), color).toBe(true);
      expect(new Set(list).size, list.join(" | ")).toBe(list.length);
    }
    // A type is the same colour in the donut, in its dot and in its bar.
    expect(dots).toEqual(slices);
    expect(bars).toEqual(slices);
  });

  it("has no hex or hsl colour left in the card", () => {
    const { view } = renderCard();
    expect(view.container.innerHTML).not.toMatch(/hsl\(|fill="#|background:\s*#/i);
  });
});
