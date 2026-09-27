import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ActivityCharts from "@/app/(protected)/team/ActivityCharts";
import type { TeamActivity } from "@/lib/team-activity";

// The web's own component, as the desktop loads it (through the Vite plugin
// that applies src/desktop-texts/overrides.ts).
const EMPTY: TeamActivity = {
  from: "2026-09-01",
  to: "2026-09-27",
  days: 27,
  generatedAt: "2026-09-27T08:00:00Z",
  dates: [],
  roles: [],
  actors: [],
  roleDaily: [],
  roleTotals: { scout: 0, analista: 0, scorer: 0, scrittore: 0, critico: 0 },
  totalAll: 0,
  recent: [],
  timeline: [],
};

afterEach(() => localStorage.removeItem("jht-lang"));

describe("/team with no activity, in the desktop", () => {
  it.each([
    ["it", "Nessun dato del team: arriva quando il tuo team sincronizza col cloud."],
    ["en", "No team data yet: it arrives when your team syncs with the cloud."],
  ])("[%s] says the data arrives when the team syncs, never a local SQLite", async (lang, text) => {
    localStorage.setItem("jht-lang", lang);
    const { container } = render(<ActivityCharts activity={EMPTY} />);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/SQLite/);
  });
});
