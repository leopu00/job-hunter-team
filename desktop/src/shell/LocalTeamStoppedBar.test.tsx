import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportLocalTeamRead, setLocalTeamData } from "../lib/local-team-data";
import { LocalTeamStoppedBar, savedMoment } from "./LocalTeamStoppedBar";

vi.mock("./StartTeamAction", () => ({ StartTeamAction: () => <button type="button">start</button> }));
vi.mock("../lib/app-locale", () => ({ appLocale: () => "en" }));

afterEach(() => setLocalTeamData(null));

describe("the bar of a team that is off", () => {
  it("says nothing while the team is up", () => {
    setLocalTeamData("local:abc");
    render(<LocalTeamStoppedBar />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says why the pages are empty when there is nothing saved to show", () => {
    setLocalTeamData("local:abc");
    render(<LocalTeamStoppedBar />);
    act(() => reportLocalTeamRead("local_team_not_running"));
    expect(screen.getByTestId("local-team-stopped")).toBeTruthy();
    expect(screen.queryByTestId("local-team-saved")).toBeNull();
  });

  it("says the data are the saved ones, and when they were written, with the button that starts the team", () => {
    setLocalTeamData("local:abc");
    render(<LocalTeamStoppedBar />);
    const at = Math.floor(Date.now() / 1000) - 600;
    act(() => reportLocalTeamRead(null, { at }));
    const bar = screen.getByTestId("local-team-saved");
    expect(bar.textContent).toContain(`Team off: data updated at ${savedMoment(at, "en")}.`);
    expect(bar.textContent).toContain("to change something or ask the team, start it");
    expect(screen.getByRole("button", { name: "start" })).toBeTruthy();
    // a page that asks for what only the team has fails: the bar stays the saved one
    act(() => reportLocalTeamRead("local_team_not_running"));
    expect(screen.getByTestId("local-team-saved")).toBeTruthy();
    expect(screen.queryByTestId("local-team-stopped")).toBeNull();
    // the team is up: it goes
    act(() => reportLocalTeamRead(null));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not say a time for a team that never ran", () => {
    setLocalTeamData("local:abc");
    render(<LocalTeamStoppedBar />);
    act(() => reportLocalTeamRead(null, { at: null }));
    expect(screen.getByTestId("local-team-saved").textContent).toContain("Team off: this is the saved data.");
  });

  it("writes the time of today as hours and minutes and an older one with its day", () => {
    const now = new Date(2026, 10, 5, 15, 0, 0);
    const today = Math.floor(new Date(2026, 10, 5, 14, 5, 0).getTime() / 1000);
    expect(savedMoment(today, "en", now)).toMatch(/2:05|14:05/);
    const older = Math.floor(new Date(2026, 10, 3, 9, 30, 0).getTime() / 1000);
    expect(savedMoment(older, "en", now)).toMatch(/Nov/);
  });
});
