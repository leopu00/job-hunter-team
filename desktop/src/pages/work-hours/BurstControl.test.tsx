import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import { EFFORTS, MODEL_CLASSES, ROLES, WEEKDAYS } from "../../lib/team-settings-native";
import BurstControl, { BurstStrip } from "./BurstControl";
import { BURST_TEXT } from "./burst.i18n";
import WorkHoursPage from "./index";

// «Work flat out until HH:MM» against a stand-in native side (team_settings). Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

const KEY = "key-1";
const IN_AN_HOUR = () => new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d+Z$/, "+00:00");
const reply = (fields: Record<string, unknown> = {}) => ({
  ok: true,
  target: "local",
  connectionKey: KEY,
  working_hours: null,
  role_models: {},
  lists: { roles: [...ROLES], models: [...MODEL_CLASSES], efforts: [...EFFORTS], weekdays: [...WEEKDAYS], min_window_hours: 4 },
  ...fields,
});
const running = () => ({ active: true, until: IN_AN_HOUR(), untilLocal: "03:00" });
const requests = () => native.invoke.mock.calls.filter(([command]) => command === "team_settings").map(([, args]) => (args as { request: Record<string, unknown> }).request);

function answer(by: (request: Record<string, unknown>) => Record<string, unknown>) {
  native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) => by(args.request));
}

beforeEach(() => {
  localStorage.setItem("jht-lang", "en");
  native.invoke.mockReset();
  answer(() => reply());
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
});

describe("work flat out until a time", () => {
  it("starts with the chosen time and the key, and shows the strip the box answered", async () => {
    answer((request) => (request.op === "burst_start" ? reply({ burst: running() }) : reply({ burst: { active: false } })));
    render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByTestId("burst-time"), "03:00");
    expect(screen.getByTestId("burst-start")).toHaveTextContent("Work at full throttle until 03:00");
    await user.click(screen.getByTestId("burst-start"));
    expect(await screen.findByTestId("burst-active")).toHaveTextContent("Full throttle until 03:00");
    expect(requests().at(-1)).toEqual({ op: "burst_start", until: "03:00", connectionKey: KEY });
    expect(screen.getByTestId("burst-note")).toHaveTextContent("Started: the team is working at full throttle until 03:00.");
    expect(screen.queryByTestId("burst-start")).toBeNull();
  });

  it("without a time it says so and sends nothing", async () => {
    render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("burst-start"));
    expect(screen.getByTestId("burst-note")).toHaveTextContent("Choose the time.");
    expect(requests().map((r) => r.op)).toEqual(["read"]);
  });

  it("says why when the box refuses, and keeps the gesture", async () => {
    answer((request) => (request.op === "burst_start" ? { ok: false, error: "team_settings_burst_too_far" } : reply()));
    render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByTestId("burst-time"), "03:00");
    await user.click(screen.getByTestId("burst-start"));
    expect(await screen.findByTestId("burst-note")).toHaveTextContent("more than 12 hours from now");
    expect(screen.getByTestId("burst-note")).toHaveTextContent("Choose a time within 12 hours and try again.");
    expect(screen.getByTestId("burst-start")).toBeEnabled();
  });

  it("stops now: the key goes with it and the strip gives way to the gesture", async () => {
    answer((request) => reply(request.op === "burst_stop" ? { burst: { active: false } } : { burst: running() }));
    render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("burst-stop"));
    expect(await screen.findByTestId("burst-start")).toBeInTheDocument();
    expect(requests().at(-1)).toEqual({ op: "burst_stop", connectionKey: KEY });
    expect(screen.getByTestId("burst-note")).toHaveTextContent("Stopped: the earlier hours are back.");
  });

  it("a click while the first is still running sends one request, not two", async () => {
    let release: (value: Record<string, unknown>) => void = () => {};
    native.invoke.mockImplementation(async (_command: string, args: { request: Record<string, unknown> }) =>
      args.request.op === "burst_start" ? new Promise((resolve) => { release = resolve; }) : reply());
    render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByTestId("burst-time"), "03:00");
    await user.click(screen.getByTestId("burst-start"));
    await user.click(screen.getByTestId("burst-start"));
    expect(requests().filter((r) => r.op === "burst_start")).toHaveLength(1);
    release(reply({ burst: running() }));
    await screen.findByTestId("burst-active");
  });

  it("a strip whose time has passed gives way to the gesture, and a box that says nothing gets no strip", async () => {
    const gone = { active: true, until: "2020-01-01T00:00:00+00:00", untilLocal: "03:00" };
    const onSettings = vi.fn();
    const base = { target: "local" as const, connectionKey: KEY, workingHours: null, roleModels: {} };
    render(<BurstControl settings={{ ...base, burst: gone }} onSettings={onSettings} />);
    expect(screen.queryByTestId("burst-active")).toBeNull();
    expect(screen.getByTestId("burst-start")).toBeInTheDocument();
    cleanup();
    render(<BurstControl settings={base} onSettings={onSettings} />);
    expect(screen.queryByTestId("burst-active")).toBeNull();
    expect(screen.getByTestId("burst-start")).toBeInTheDocument();
  });

  it("next to «Stop the team» the strip reads the settings itself, in the short form, and shows nothing until it can", async () => {
    native.invoke.mockImplementation(async () => ({ ok: false, error: "team_settings_unavailable" }));
    const { container } = render(<BurstStrip />);
    await waitFor(() => expect(requests()).toEqual([{ op: "read" }]));
    expect(container).toBeEmptyDOMElement();
    cleanup();
    answer(() => reply());
    render(<BurstStrip />);
    expect(await screen.findByTestId("burst-start")).toHaveTextContent("Work at full throttle");
    expect(screen.queryByText(BURST_TEXT.en.burstIntro)).toBeNull();
  });

  it("is written in the seven languages with the time slot intact", () => {
    for (const locale of Object.keys(BURST_TEXT) as Locale[]) {
      const text = BURST_TEXT[locale];
      for (const key of ["burstStart", "burstActive", "burstStarted"] as const) expect(text[key], `${locale} ${key}`).toContain("{time}");
      for (const [key, value] of Object.entries(text)) expect(value.trim(), `${locale} ${key}`).not.toBe("");
    }
  });
});
