import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import { EFFORTS, MODEL_CLASSES, ROLES, WEEKDAYS } from "../../lib/team-settings-native";
import WorkHoursPage from "./index";
import { WORK_HOURS_TEXT } from "./work-hours.i18n";

// «Working hours» against a stand-in native side (team_settings). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const props = { params: {}, search: new URLSearchParams() };
const KEY = "key-1";
const OFFICE = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }] };
const reply = (fields: Record<string, unknown> = {}) => ({
  ok: true,
  target: "local",
  connectionKey: KEY,
  working_hours: null,
  role_models: { capitano: { model: "terra" } },
  lists: { roles: [...ROLES], models: [...MODEL_CLASSES], efforts: [...EFFORTS], weekdays: [...WEEKDAYS], min_window_hours: 4 },
  ...fields,
});
const calls = () => native.invoke.mock.calls.filter(([command]) => command === "team_settings").map(([, args]) => (args as { request: Record<string, unknown> }).request);

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en; path=/";
  localStorage.setItem("jht-lang", "en");
  native.invoke.mockReset();
  native.invoke.mockImplementation(async () => reply());
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the working hours page", () => {
  it("reads the team's hours, says whose they are and what a change does", async () => {
    render(<WorkHoursPage {...props} />);
    expect(await screen.findByTestId("work-hours-intro")).toHaveTextContent("for the team on this computer");
    expect(calls()).toEqual([{ op: "read" }]);
    expect(screen.getByTestId("work-hours-consequence")).toHaveTextContent(
      "The new hours apply from the team's next check (within about 15 minutes); they do not interrupt work in progress.",
    );
    expect(screen.getByTestId("work-hours-unreadable")).toHaveTextContent(
      "If the hours cannot be read, the team works with no hours limit until you save them again.",
    );
    // the model and effort of each role are the other page's
    expect(screen.queryByTestId("team-settings-models")).toBeNull();
    cleanup();
    native.invoke.mockImplementation(async () => reply({ target: "vps" }));
    render(<WorkHoursPage {...props} />);
    expect(await screen.findByTestId("work-hours-intro")).toHaveTextContent("for the team on the VPS");
  });

  it("does not tell the person the preview needs an active container, which is not true here", async () => {
    native.invoke.mockImplementation(async () => reply({ working_hours: OFFICE }));
    render(<WorkHoursPage {...props} />);
    await waitFor(() => expect(screen.getAllByText("Mon").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Preview available only/)).toBeNull();
  });

  it("asks the team for the hours of a preset with the key the read gave, and writes only the hours", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) =>
      args.request.op === "read" ? reply() : reply({ working_hours: OFFICE }),
    );
    render(<WorkHoursPage {...props} />);
    await user.click(await screen.findByRole("button", { name: /Office \(Mon-Fri 9-18\)/ }));
    await waitFor(() => expect(calls()).toHaveLength(2));
    const write = calls()[1] as { op: string; connectionKey: string; settings: { working_hours: { windows: unknown } } };
    expect(write.op).toBe("write");
    expect(write.connectionKey).toBe(KEY);
    expect(Object.keys(write.settings)).toEqual(["working_hours"]);
    expect(write.settings.working_hours.windows).toEqual(OFFICE.windows);
  });

  it("says it cannot read the hours, and reads again on request", async () => {
    const user = userEvent.setup();
    native.invoke.mockImplementationOnce(async () => ({ ok: false, error: "existing_team_runtime_outdated" }));
    render(<WorkHoursPage {...props} />);
    const failed = await screen.findByTestId("work-hours-failed");
    expect(failed).toHaveTextContent("Cannot read the team's hours.");
    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("work-hours-intro")).toBeInTheDocument();
  });

  it("has every language's words", () => {
    for (const [locale, text] of Object.entries(WORK_HOURS_TEXT) as [Locale, (typeof WORK_HOURS_TEXT)[Locale]][]) {
      for (const [key, value] of Object.entries(text)) expect(value.trim().length, `${locale} ${key}`).toBeGreaterThan(1);
      // the sentence about a change says the number of minutes it is true for
      expect(text.consequence, locale).toMatch(/15/);
    }
    expect(Object.keys(WORK_HOURS_TEXT).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });

  it("says a change applies at the next check only while the team's code really rereads the hours every time", () => {
    // the sentence is true because working_hours.py reads the file from disk at every call: no cache, no restart
    const source = readFileSync("../shared/skills/working_hours.py", "utf8");
    expect(source).not.toMatch(/lru_cache|functools\.cache|@cache\b|_CACHE\b/);
    const gate = source.slice(source.indexOf("def is_within_working_hours"), source.indexOf("def current_window_bounds"));
    expect(gate).toMatch(/_load_config\(\)/);
  });
});
