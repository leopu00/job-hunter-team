import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LocationBarList from "@/app/components/LocationBarList";
import DashboardScreen from "./DashboardScreen";
import { fixtureData } from "./dashboard-fixture";

// The Countries and Cities cards put the title and the count on one centred
// row. `.section-label` carries a 14px bottom margin, which in that row lifted
// the title 7px above the count; the row's own margin does that job now.
describe("Countries/Cities card header", () => {
  it("drops the title's own bottom margin so it sits on the count's line", () => {
    render(
      <LocationBarList
        items={[{ key: "it", label: "Italy", count: 4 }]}
        title="Countries"
        emptyLabel="No data"
        headerCount={1}
      />,
    );
    expect(screen.getByText("Countries")).toHaveClass("section-label", "mb-0!");
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

describe("Dashboard card headers", () => {
  it("every title that shares its row with a count, legend or control drops the 14px margin", () => {
    const { container } = render(<DashboardScreen data={fixtureData()} locale="en" />);
    const inRow = [...container.querySelectorAll(".section-label")].filter((label) => {
      const row = label.parentElement;
      return row?.classList.contains("justify-between") && row.children.length > 1;
    });
    // Types, Applications sent, Countries, Score, Salary, Cities, and the tables' headers.
    expect(inRow.length).toBeGreaterThanOrEqual(6);
    const stillLifted = inRow.filter((label) => !label.classList.contains("mb-0!")).map((label) => label.textContent);
    expect(stillLifted).toEqual([]);
  });
});
