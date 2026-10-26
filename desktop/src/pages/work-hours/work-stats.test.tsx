import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import WorkStatsCard, { MIN_NIGHTS, samplesAreNights } from "./WorkStatsCard";
import { WORK_STATS_TEXT } from "./work-stats.i18n";

// «What happened» against a stand-in native side (work_stats_read / work_stats_clear). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const NOW = new Date("2026-10-26T12:00:00Z");
const NIGHT_HOURS = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"] as never, start: "22:00", end: "08:00" }] };
const DAY_HOURS = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"] as never, start: "09:00", end: "18:00" }] };

const night = (date: string, fields: Record<string, unknown> = {}) => ({
  date,
  hoursActive: 10,
  found: 5,
  aboveThreshold: 2,
  scoreThreshold: 75,
  consumptionPct: 3,
  turnMedianSec: null,
  ...fields,
});
const stats = (nights: unknown[], fields: Record<string, unknown> = {}) => ({
  ok: true,
  nights,
  from: nights.length ? (nights[0] as { date: string }).date : null,
  to: nights.length ? (nights[nights.length - 1] as { date: string }).date : null,
  lastObservation: "2026-10-26T08:00:00Z",
  retentionDays: 90,
  threshold: 75,
  scheduleState: "valid",
  ...fields,
});
const days = (n: number) => Array.from({ length: n }, (_, i) => night(`2026-10-${String(10 + i).padStart(2, "0")}`));
const serve = (reply: unknown) => native.invoke.mockImplementation(async () => reply);
const show = (hours = NIGHT_HOURS, target: "local" | "vps" = "local") => render(<WorkStatsCard target={target} hours={hours} now={NOW} />);

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en; path=/";
  localStorage.setItem("jht-lang", "en");
  native.invoke.mockReset();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("what happened", () => {
  it("says there is no data yet when no night was archived, and adds up nothing", async () => {
    serve(stats([]));
    show();
    expect(await screen.findByTestId("work-stats-none")).toHaveTextContent("There is no data yet: the team has to work at least 3 nights.");
    expect(screen.queryByTestId("work-stats-summary")).toBeNull();
    expect(screen.queryByTestId("work-stats-table")).toBeNull();
  });

  it("says the data is not enough under the minimum, shows the nights it has, and adds up nothing", async () => {
    serve(stats(days(MIN_NIGHTS - 1)));
    show();
    expect(await screen.findByTestId("work-stats-insufficient")).toHaveTextContent("Not enough data: 2 of 3 nights.");
    expect(screen.queryByTestId("work-stats-summary")).toBeNull();
    expect(screen.getAllByTestId("work-stats-row")).toHaveLength(2);
  });

  it("adds up from the minimum, each number with the nights it comes from", async () => {
    serve(stats(days(MIN_NIGHTS)));
    show();
    const summary = await screen.findByTestId("work-stats-summary");
    expect(screen.getByTestId("work-stats-found-total")).toHaveTextContent("15");
    expect(screen.getByTestId("work-stats-above-total")).toHaveTextContent("6");
    expect(screen.getByTestId("work-stats-use-total")).toHaveTextContent("9");
    // the sample next to every number, not once at the top
    expect(within(summary).getAllByText("(from 3 nights)")).toHaveLength(3);
    expect(screen.queryByTestId("work-stats-insufficient")).toBeNull();
  });

  it("counts a night with under an hour of work for nothing", async () => {
    serve(stats([...days(2), night("2026-10-20", { hoursActive: 0.5 })]));
    show();
    expect(await screen.findByTestId("work-stats-insufficient")).toHaveTextContent("2 of 3");
  });

  it("says «not available» for a night with nothing counted, and adds up only the nights that have a count", async () => {
    serve(stats([night("2026-10-10", { found: null }), night("2026-10-11"), night("2026-10-12"), night("2026-10-13")]));
    show();
    const summary = await screen.findByTestId("work-stats-summary");
    expect(screen.getByTestId("work-stats-found-total")).toHaveTextContent("15");
    expect(within(summary).getAllByText("(from 3 nights)").length).toBeGreaterThanOrEqual(1);
    expect(within(screen.getAllByTestId("work-stats-row")[0]).getAllByText("not available")).toHaveLength(1);
  });

  it("raises an alert when the team's hours file cannot be read, and only then", async () => {
    serve(stats(days(3), { scheduleState: "unreadable" }));
    show();
    expect(await screen.findByTestId("work-stats-schedule-unreadable")).toHaveTextContent("the team works with no hours limit until you save them again");
    cleanup();
    for (const scheduleState of ["valid", "undeclared"]) {
      serve(stats(days(3), { scheduleState }));
      show();
      await screen.findByTestId("work-stats-summary");
      expect(screen.queryByTestId("work-stats-schedule-unreadable")).toBeNull();
      cleanup();
    }
  });

  it("says «not available» for a number the team does not have, never 0, and each total with its own sample", async () => {
    serve(stats([night("2026-10-10", { aboveThreshold: null }), night("2026-10-11", { aboveThreshold: null, consumptionPct: null }), night("2026-10-12", { aboveThreshold: 4, consumptionPct: null })]));
    show();
    const summary = await screen.findByTestId("work-stats-summary");
    expect(screen.getByTestId("work-stats-above-total")).toHaveTextContent("4");
    // «above» and «use» each have one night of data, said next to their own number
    expect(within(summary).getAllByText("(from 1 night)")).toHaveLength(2);
    expect(screen.getByTestId("work-stats-use-total")).toHaveTextContent("3");
    const rows = screen.getAllByTestId("work-stats-row");
    expect(within(rows[1]).getAllByText("not available")).toHaveLength(2);
    cleanup();
    serve(stats(days(3).map((n) => ({ ...n, aboveThreshold: null, consumptionPct: null }))));
    show();
    await screen.findByTestId("work-stats-summary");
    expect(screen.queryByTestId("work-stats-above-total")).toBeNull();
    expect(screen.queryByTestId("work-stats-use-total")).toBeNull();
    expect(screen.getByText(/above the score threshold \(75\): not available/)).toBeInTheDocument();
  });

  it("never adds up two score thresholds: «above» counts only the nights with today's, and says how many it left out", async () => {
    const at = (threshold: number, from: number, count: number) =>
      Array.from({ length: count }, (_, i) => night(`2026-10-${String(from + i).padStart(2, "0")}`, { scoreThreshold: threshold, aboveThreshold: 2 }));
    serve(stats([...at(70, 10, 3), ...at(75, 13, 4)], { threshold: 75 }));
    show();
    const summary = await screen.findByTestId("work-stats-summary");
    // 4 nights at 75 × 2 = 8; the 3 nights at 70 are not in it, and the total says which threshold it is
    expect(screen.getByTestId("work-stats-above-total")).toHaveTextContent("8");
    expect(summary).toHaveTextContent("above the score threshold (75)");
    expect(within(summary).getAllByText("(from 4 nights)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("work-stats-other-threshold")).toHaveTextContent("3 nights with another score threshold are not in the «above threshold» total.");
    // the found total still counts all seven nights: the threshold does not touch it
    expect(screen.getByTestId("work-stats-found-total")).toHaveTextContent("35");
    // each night shows the threshold its number was counted with
    expect(within(screen.getAllByTestId("work-stats-row")[0]).getByText("2 (≥ 70)")).toBeInTheDocument();
    expect(within(screen.getAllByTestId("work-stats-row")[6]).getByText("2 (≥ 75)")).toBeInTheDocument();
    cleanup();
    serve(stats(at(70, 10, 3), { threshold: 75 }));
    show();
    await screen.findByTestId("work-stats-summary");
    expect(screen.queryByTestId("work-stats-above-total")).toBeNull();
    expect(screen.getByText(/above the score threshold \(75\): not available/)).toBeInTheDocument();
  });

  it("says the totals count only the nights with at least one hour of work", async () => {
    serve(stats(days(3)));
    show();
    expect(await screen.findByTestId("work-stats-legend")).toHaveTextContent("The totals count only the nights with at least 1 hour of work.");
  });

  it("calls old data old, and still shows it", async () => {
    serve(stats(days(3), { lastObservation: "2026-10-10T08:00:00Z" }));
    show();
    expect(await screen.findByTestId("work-stats-stale")).toHaveTextContent("The data is 16 days old");
    expect(screen.getByTestId("work-stats-summary")).toBeInTheDocument();
  });

  it("speaks of days, not nights, for hours with no night in them or for 24/7", async () => {
    serve(stats(days(2)));
    show(DAY_HOURS as never);
    expect(await screen.findByTestId("work-stats-insufficient")).toHaveTextContent("2 of 3 days");
    expect(samplesAreNights(null)).toBe(false);
    expect(samplesAreNights({ timezone: "UTC", windows: [] })).toBe(false);
    expect(samplesAreNights(DAY_HOURS as never)).toBe(false);
    expect(samplesAreNights(NIGHT_HOURS as never)).toBe(true);
  });

  it("says where the statistics are kept, and for how long", async () => {
    serve(stats(days(3)));
    show(NIGHT_HOURS, "vps");
    expect(await screen.findByTestId("work-stats-where")).toHaveTextContent("kept on the team's VPS; they are kept for 90 days at most");
    cleanup();
    show(NIGHT_HOURS, "local");
    await waitFor(() => expect(screen.getByTestId("work-stats-where")).toHaveTextContent("kept on this computer"));
  });

  it("says it cannot read, with the cause, and reads again on request; a reply off the closed shape is never a number", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementationOnce(async () => ({ ok: false, error: "stats_unreadable" }));
    native.invoke.mockImplementation(async () => stats(days(3)));
    show();
    const failed = await screen.findByTestId("work-stats-failed");
    expect(failed).toHaveTextContent("Cannot read the statistics.");
    expect(failed).toHaveTextContent("The team's statistics cannot be read.");
    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("work-stats-summary")).toBeInTheDocument();
    cleanup();
    serve(stats(days(3).map((n) => ({ ...n, note: "extra field" }))));
    show();
    expect(await screen.findByTestId("work-stats-failed")).toHaveTextContent("does not offer the working-hours statistics yet");
    expect(screen.queryByTestId("work-stats-table")).toBeNull();
  });

  it("clears only after a confirmation that says the team collects again, then shows no data", async () => {
    const user = userEvent.setup();
    let cleared = false;
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "work_stats_clear") {
        cleared = true;
        return { ok: true };
      }
      return cleared ? stats([]) : stats(days(3));
    });
    show();
    await user.click(await screen.findByTestId("work-stats-clear"));
    expect(screen.getByTestId("work-stats-confirm")).toHaveTextContent("The team starts collecting them again at its next check.");
    expect(native.invoke.mock.calls.some(([command]) => command === "work_stats_clear")).toBe(false);
    await user.click(screen.getByTestId("work-stats-clear-yes"));
    expect(await screen.findByTestId("work-stats-none")).toBeInTheDocument();
    expect(screen.getByTestId("work-stats-cleared")).toHaveTextContent("starts collecting them again");
  });

  it("does not clear when the person says no, and says why when the team refuses", async () => {
    const user = userEvent.setup();
    serve(stats(days(3)));
    show();
    await user.click(await screen.findByTestId("work-stats-clear"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("work-stats-confirm")).toBeNull();
    expect(native.invoke.mock.calls.some(([command]) => command === "work_stats_clear")).toBe(false);
    native.invoke.mockImplementation(async (command: string) => (command === "work_stats_clear" ? { ok: false, error: "stats_clear_failed" } : stats(days(3))));
    await user.click(screen.getByTestId("work-stats-clear"));
    await user.click(screen.getByTestId("work-stats-clear-yes"));
    expect(await screen.findByTestId("work-stats-clear-problem")).toHaveTextContent("The statistics were not cleared.");
    expect(screen.getByTestId("work-stats-table")).toBeInTheDocument();
  });

  it("has every language's words, none that promise, and the confirmation says the collection resumes", () => {
    // what the page may never say: it only reports what already happened
    const FORBIDDEN: Record<Locale, RegExp> = {
      it: /garantit|otterrai|risparmier|prometti/i,
      en: /guarantee|you will (get|save)|promise/i,
      de: /garantier|du wirst|versprech/i,
      fr: /garanti|tu obtiendras|promet/i,
      es: /garantiz|obtendrás|ahorrarás|promet/i,
      pt: /garant|vais obter|vais poupar|promet/i,
      hu: /garant|ígér/i,
    };
    expect(Object.keys(WORK_STATS_TEXT).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
    for (const [locale, text] of Object.entries(WORK_STATS_TEXT) as [Locale, (typeof WORK_STATS_TEXT)[Locale]][]) {
      for (const [key, value] of Object.entries(text)) {
        expect(value.trim().length, `${locale} ${key}`).toBeGreaterThan(1);
        expect(value, `${locale} ${key}`).not.toMatch(FORBIDDEN[locale]);
      }
      // the sample is a word of its own, in every sentence that carries a number
      for (const key of ["sample", "range", "none", "insufficient"] as const) expect(text[key], `${locale} ${key}`).toMatch(/\{(n|sample|unit)\}/);
      expect(text.clearAsk.trim().length, locale).toBeGreaterThan(20);
      expect(text.cleared, locale).not.toBe(text.clearAsk);
    }
  });
});
