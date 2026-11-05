import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportLocalTeamRead, setLocalTeamData } from "../lib/local-team-data";
import { LocalTeamStoppedBar, savedMoment, savedSentence } from "./LocalTeamStoppedBar";

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
    expect(bar.textContent).toContain(`Team off: data updated at ${savedMoment(at, "en").time}.`);
    expect(bar.textContent).not.toContain(" on ");
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

  it("says the day too when the data are not from today, so old data never look new", () => {
    setLocalTeamData("local:abc");
    render(<LocalTeamStoppedBar />);
    const threeDaysAgo = Math.floor(Date.now() / 1000) - 3 * 86400;
    act(() => reportLocalTeamRead(null, { at: threeDaysAgo }));
    const { day, time } = savedMoment(threeDaysAgo, "en");
    expect(screen.getByTestId("local-team-saved").textContent).toContain(`Team off: data updated on ${day} at ${time}.`);
  });

  it("writes today's data as «at HH:MM» and the others as «on DD/MM at HH:MM», in Italian too", () => {
    const now = new Date(2026, 10, 5, 15, 0, 0);
    const today = Math.floor(new Date(2026, 10, 5, 14, 5, 0).getTime() / 1000);
    expect(savedSentence(today, "it", now)).toBe("Squadra spenta: dati aggiornati alle 14:05.");
    const older = Math.floor(new Date(2026, 10, 3, 23, 10, 0).getTime() / 1000);
    expect(savedSentence(older, "it", now)).toBe("Squadra spenta: dati aggiornati il 03/11 alle 23:10.");
    // yesterday just before midnight is still not today
    const lateYesterday = Math.floor(new Date(2026, 10, 4, 23, 59, 0).getTime() / 1000);
    expect(savedSentence(lateYesterday, "it", now)).toContain("il 04/11 alle 23:59");
    // and every language has the sentence of the other day, with its two places
    for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"] as const) {
      expect(savedSentence(older, locale, now), locale).not.toContain("{");
    }
  });
});
