import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LocationBarList from "@/app/components/LocationBarList";

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
