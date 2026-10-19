import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PositionTypesDonut from "@/app/components/PositionTypesDonut";
import { fitCenterLabel } from "@/lib/donut-label";

const FAMILIES = [
  "Agentic AI / LLM Engineering",
  "Data Engineering / Pipelines",
  "MLOps / ML Engineering",
  "Platform Engineering / Infrastructure",
  "Forward Deployed Engineering",
  "AI Product Engineering",
  "Applied AI Engineering",
  "QA / Test Automation Engineering",
  "Business Process Automation",
  "Frontend Engineering",
  "Solutions Engineering",
  "Other",
  "Security Engineering",
  "AI Agent Platform / Governance",
];
const DATA = FAMILIES.map((family, i) => ({
  family,
  count: 100 - i * 5,
  color: "#888888",
  avgScore: 70,
  avgCritic: null,
  scores: [],
}));

describe("fitCenterLabel", () => {
  it("leaves a name that fits in the hole alone", () => {
    expect(fitCenterLabel("Other")).toBe("Other");
    expect(fitCenterLabel("  Frontend ")).toBe("Frontend");
  });

  it("cuts a long name to the hole, at a word end, with an ellipsis", () => {
    expect(fitCenterLabel("Agentic AI / LLM Engineering")).toBe("Agentic…");
    for (const family of FAMILIES) {
      expect(fitCenterLabel(family).length).toBeLessThanOrEqual(10);
    }
  });

  it("cuts inside a word that has no earlier break", () => {
    expect(fitCenterLabel("Infrastructure")).toBe("Infrastru…");
  });
});

describe("PositionTypesDonut in a card", () => {
  it("scrolls its legend inside the card instead of overflowing it", () => {
    const { container } = render(
      <PositionTypesDonut data={DATA} labels={{}} emptyLabel="none" size={150} />,
    );
    const root = container.firstElementChild as HTMLElement;
    const legend = container.querySelector("ul") as HTMLElement;
    // The legend has 14 rows and a card shows ~8: its box is the card's, and it scrolls.
    expect(legend.querySelectorAll("li")).toHaveLength(14);
    expect(root.style.height).toBe("100%");
    expect(legend.style.maxHeight).toBe("100%");
    expect(legend.className).toContain("overflow-y-auto");
  });

  it("writes a hovered long name in the hole in a shortened form, the whole name stays in the legend", () => {
    const { container } = render(
      <PositionTypesDonut data={DATA} labels={{}} emptyLabel="none" size={150} />,
    );
    fireEvent.mouseEnter(screen.getAllByText("Agentic AI / LLM Engineering")[0]);
    const center = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(center).toContain("Agentic…");
    expect(center).not.toContain("Agentic AI / LLM Engineering");
    expect(screen.getAllByText("Agentic AI / LLM Engineering").length).toBeGreaterThan(0);
  });
});
