import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RecentPositionsTable, { type TableLabels } from "@/app/components/RecentPositionsTable";
import { formatShortStamp } from "@/lib/short-stamp";
import { fixturePosition } from "./dashboard-fixture";

// One way of writing a row's date and time, per language, for the Positions
// table and the Dashboard tables alike.
const NOW = new Date("2026-10-19T09:00:00Z");
const THEN = "2026-10-03T12:00:00Z"; // midday UTC: the same calendar day in any time zone

describe("formatShortStamp", () => {
  it("writes month first in English and day first in Italian", () => {
    expect(formatShortStamp(THEN, "en", NOW)).toMatch(/^10\/03, /);
    expect(formatShortStamp(THEN, "it", NOW)).toMatch(/^03\/10, /);
    expect(formatShortStamp(THEN, "de", NOW)).toMatch(/^03\.10\., /);
  });

  it("writes only the time for today, and a dash for nothing or nonsense", () => {
    expect(formatShortStamp("2026-10-19T09:30:00Z", "en", NOW)).not.toContain("/");
    expect(formatShortStamp(null, "en", NOW)).toBe("—");
    expect(formatShortStamp("not a date", "en", NOW)).toBe("—");
  });
});

const LABELS: TableLabels = {
  title: "Latest",
  titleFiltered: "Latest",
  viewAll: "All",
  noPositions: "None",
  unseen: "New",
  colId: "ID",
  colScored: "Scored",
  colTitle: "Title",
  colCompany: "Company",
  colCountry: "Country",
  colCity: "City",
  colScore: "Score",
};

describe("the Dashboard tables write the date as Positions does", () => {
  afterEach(() => localStorage.removeItem("jht-lang"));

  it("in the app's language, not always day/month 24-hour", () => {
    localStorage.setItem("jht-lang", "en");
    const row = fixturePosition(1, { id: "d1", scored_at: THEN });
    render(<RecentPositionsTable rows={[row]} labels={LABELS} filtered={false} totalFiltered={1} firstCol="scored" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText(formatShortStamp(THEN, "en"))).toBeInTheDocument();
    expect(within(table).queryByText(/^03\/10 /)).not.toBeInTheDocument();
  });
});
