import { readFileSync } from "node:fs";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import { BUDGET_TEXT } from "./budget.i18n";
import BudgetPage, { REFRESH_MS, STALE_AFTER_MIN } from "./index";

// The Budget page against a stand-in native side (team_budget_read). Synthetic data only: the three answers the app's
// native side is tested to serve (src-tauri/tests/fixtures/budget_response.json).
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
const team = vi.hoisted(() => ({ state: vi.fn(), readOnly: vi.fn(() => null as unknown) }));
vi.mock("../../lib/agent-control", () => ({ readTeamState: team.state }));
vi.mock("../../lib/existing-team-readonly", () => ({ useExistingTeamReadOnly: team.readOnly }));
vi.mock("../work-hours/BurstControl", () => ({ BurstStrip: () => <div data-testid="burst-strip" /> }));
const go = vi.hoisted(() => vi.fn());
vi.mock("../../shell/router", () => ({ navigate: go }));

const fixtures = JSON.parse(readFileSync("src-tauri/tests/fixtures/budget_response.json", "utf8")) as Record<string, Record<string, any>>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const running = { ok: true, at: 1, value: { halted: false, standby: { state: "off" } } };
const serve = (reply: unknown) => native.invoke.mockImplementation(async () => reply);
const show = () => render(<BudgetPage params={{}} search={new URLSearchParams()} />);

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en; path=/";
  localStorage.setItem("jht-lang", "en");
  native.invoke.mockReset();
  team.state.mockReset();
  team.state.mockResolvedValue(running);
  team.readOnly.mockReturnValue(null);
  go.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the Budget page", () => {
  it("asks the one native command, with no argument", async () => {
    serve(fixtures.ahead_without_override);
    show();
    await screen.findByTestId("budget-week");
    expect(native.invoke.mock.calls.map((call) => call[0])).toEqual(["team_budget_read"]);
  });

  it("says where the week is against the line of the working hours, how much is left and when it resets", async () => {
    serve(fixtures.ahead_without_override);
    show();
    const week = await screen.findByTestId("budget-week");
    expect(week).toHaveTextContent("78 %");
    expect(within(week).getByTestId("budget-line")).toHaveTextContent("You are 18.9 points ahead of the line.");
    expect(week).toHaveTextContent("You should be at 59.1 %: that is the line of the working hours, not of the calendar days.");
    expect(within(week).getByRole("img")).toHaveAccessibleName("Usage of the week: 78 % used, line at 59.1 %");
    expect(within(week).getByTestId("budget-bar-used")).toHaveStyle({ width: "78%" });
    expect(within(week).getByTestId("budget-bar-ideal")).toHaveStyle({ left: "59.1%" });
    const left = screen.getByTestId("budget-left");
    expect(left).toHaveTextContent("22 % is left.");
    expect(left).toHaveTextContent("It resets");
    expect(left).toHaveTextContent("Until then the team works about 29 hours.");
  });

  it("puts the pace, the forecast and the brakes in plain words, each brake with its reason", async () => {
    serve(fixtures.ahead_without_override);
    show();
    const rate = await screen.findByTestId("budget-rate");
    expect(rate).toHaveTextContent("To reach the reset without running out");
    const brakes = screen.getByTestId("budget-brakes");
    expect(brakes).toHaveTextContent("The team goes slower because you have already used more than the line of the working hours allows.");
    expect(brakes).toHaveTextContent("Pause between one job and the next: 900 seconds.");
    expect(screen.queryByTestId("budget-brakes-none")).toBeNull();
    expect(screen.queryByTestId("budget-brakes-burn")).toBeNull();
    expect(screen.getByTestId("budget-burn-state")).toHaveTextContent("Off: the team keeps to the line of the working hours.");
  });

  it("shows «Work flat out» with what it has cost and the one brake that stays on", async () => {
    serve(fixtures.override_lockout_risk);
    show();
    const burn = await screen.findByTestId("budget-burn");
    expect(within(burn).getByTestId("budget-burn-state")).toHaveTextContent(/^On: .* to go, until \d{2}:\d{2}( [AP]M)?\.$/);
    expect(within(burn).getByTestId("budget-burn-cost")).toHaveTextContent("Cost so far: 7 points of the week.");
    expect(within(burn).getByTestId("budget-burn-wall")).toHaveTextContent("the one brake that stays on");
    const brakes = screen.getByTestId("budget-brakes");
    expect(brakes).toHaveTextContent("at this pace, the budget would run out before the reset");
    expect(within(brakes).getByTestId("budget-brakes-burn")).toHaveTextContent("being ahead of the line does not brake");
  });

  it("says the cost is not available when the team cannot say it, never 0", async () => {
    const reply = clone(fixtures.override_lockout_risk);
    reply.burn.spentPts = null;
    serve(reply);
    show();
    expect(await screen.findByTestId("budget-burn-cost")).toHaveTextContent("Cost so far: not available.");
  });

  it("says there is no reading yet, and nothing is made up", async () => {
    serve(fixtures.no_data);
    show();
    expect(await screen.findByTestId("budget-freshness")).toHaveTextContent("No reading of the usage yet");
    expect(screen.getByTestId("budget-week")).toHaveTextContent("not available");
    expect(screen.getByTestId("budget-left")).toHaveTextContent("not available");
    expect(screen.getByTestId("budget-rate")).toHaveTextContent("There are not enough readings for a forecast.");
    expect(screen.getByTestId("budget-brakes-none")).toHaveTextContent("No brake: the team works at its own pace.");
    expect(screen.getByTestId("budget-roles")).toHaveTextContent("The usage by agent is not available.");
    expect(screen.queryByTestId("budget-bar")).toBeNull();
  });

  it("calls an old reading old", async () => {
    const reply = clone(fixtures.ahead_without_override);
    reply.sampleAgeMin = STALE_AFTER_MIN + 25;
    serve(reply);
    show();
    expect(await screen.findByTestId("budget-freshness")).toHaveTextContent("The reading is 40 min old: the team may be stopped or off.");
  });

  it("shows the usage by role, the biggest first, with the share and the agents", async () => {
    serve(fixtures.ahead_without_override);
    show();
    const roles = await screen.findByTestId("budget-roles");
    expect(within(roles).getByTestId("budget-role-scout")).toHaveTextContent("Scout60 % · 2 agents");
    expect(within(roles).getByTestId("budget-role-analista")).toHaveTextContent("Analyst20 % · 1 agent");
    expect(roles).toHaveTextContent("Not attributed to a role: 10 %.");
    const order = within(roles).getAllByRole("listitem").map((item) => item.getAttribute("data-testid"));
    expect(order).toEqual(["budget-role-scout", "budget-role-analista", "budget-role-scorer"]);
  });

  it("says that the team is stopped or paused, as a brake", async () => {
    serve(fixtures.ahead_without_override);
    team.state.mockResolvedValue({ ok: true, at: 1, value: { halted: true, standby: { state: "off" } } });
    show();
    expect(await screen.findByTestId("budget-brakes")).toHaveTextContent("The team is stopped.");
    cleanup();
    team.state.mockResolvedValue({ ok: true, at: 1, value: { halted: false, standby: { state: "active" } } });
    show();
    await waitFor(() => expect(screen.getByTestId("budget-brakes")).toHaveTextContent("The team is paused."));
  });

  it("says the budget cannot be read, with the reason in words, and reads again on request", async () => {
    native.invoke.mockRejectedValue(new Error("invalid_request"));
    const user = userEvent.setup();
    show();
    const failed = await screen.findByTestId("budget-failed");
    expect(failed).toHaveTextContent("The budget cannot be read.");
    expect(failed).toHaveTextContent("The team does not offer the budget figures yet.");
    expect(failed).not.toHaveTextContent("budget_unavailable");
    serve(fixtures.ahead_without_override);
    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("budget-week")).toBeInTheDocument();
  });

  it("reads again by itself while it is open, and stops when it is left", async () => {
    const timers: Array<() => void> = [];
    const cleared: unknown[] = [];
    vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, ms?: number) => {
      if (ms === REFRESH_MS) timers.push(callback);
      return timers.length as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    vi.spyOn(globalThis, "clearInterval").mockImplementation(((id: unknown) => void cleared.push(id)) as typeof clearInterval);
    serve(fixtures.ahead_without_override);
    const view = show();
    await screen.findByTestId("budget-week");
    expect(timers).toHaveLength(1);
    const before = native.invoke.mock.calls.length;
    const fresh = clone(fixtures.ahead_without_override);
    fresh.week.usedPct = 80;
    serve(fresh);
    await act(async () => {
      timers[0]();
    });
    await waitFor(() => expect(screen.getByTestId("budget-week")).toHaveTextContent("80 %"));
    expect(native.invoke.mock.calls.length).toBe(before + 1);
    view.unmount();
    expect(cleared.length).toBeGreaterThan(0);
  });

  it("on a team that is only read, shows the numbers and offers no control", async () => {
    team.readOnly.mockReturnValue({ host: "x" });
    serve(fixtures.override_lockout_risk);
    show();
    await screen.findByTestId("budget-burn");
    expect(screen.queryByTestId("burst-strip")).toBeNull();
    expect(screen.queryByTestId("budget-hours-link")).toBeNull();
    expect(native.invoke.mock.calls.map((call) => call[0])).toEqual(["team_budget_read"]);
  });

  it("leads to the hours and the share, where they are set, and shows the control of «Work flat out»", async () => {
    serve(fixtures.ahead_without_override);
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByTestId("budget-hours-link"));
    expect(go).toHaveBeenCalledWith("/settings/hours");
    expect(screen.getByTestId("burst-strip")).toBeInTheDocument();
  });
});

describe("the words of the page", () => {
  it("has the same keys in the seven languages and no slot left open in any sentence of the page", async () => {
    const keys = Object.keys(BUDGET_TEXT.it).sort();
    for (const locale of locales) expect(Object.keys(BUDGET_TEXT[locale]).sort(), locale).toEqual(keys);
    for (const locale of locales) {
      localStorage.setItem("jht-lang", locale);
      document.cookie = `NEXT_LOCALE=${locale}; path=/`;
      serve(fixtures.override_lockout_risk);
      const view = show();
      await screen.findByTestId("budget-week");
      expect(view.container.textContent, locale).not.toMatch(/[{}]/);
      expect(view.container.textContent, locale).not.toMatch(/\b(?:[a-z]+_){1,}[a-z]+\b/);
      expect(view.container.querySelector("h1")?.textContent, locale).toBe(BUDGET_TEXT[locale].title);
      view.unmount();
    }
  });

  it("says every brake and every role the team can name, in every language", () => {
    const brakes = ["pace_ahead", "lockout_risk", "daily_cap_stop", "recovering_after_freeze", "pause_between_jobs"];
    const roles = ["capitano", "sentinella", "assistente", "mentor", "dottore", "mantenitore", "scout", "analista", "scorer", "scrittore", "critico", "tesoriere", "closer"];
    for (const locale of locales) {
      for (const brake of brakes) expect((BUDGET_TEXT[locale] as Record<string, string>)[`brake_${brake}`]?.length, `${locale}/${brake}`).toBeGreaterThan(10);
      for (const role of roles) expect((BUDGET_TEXT[locale] as Record<string, string>)[`role_${role}`]?.length, `${locale}/${role}`).toBeGreaterThan(2);
    }
  });
});
