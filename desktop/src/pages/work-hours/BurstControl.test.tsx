import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import { EFFORTS, MODEL_CLASSES, ROLES, WEEKDAYS, type TeamSettings } from "../../lib/team-settings-native";
import BurstControl, { BurstStrip, DEFAULT_HOURS, QUICK_HOURS, UNDO_MS, clockIn, untilIn } from "./BurstControl";
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
    expect(screen.getByTestId("burst-undo")).toHaveTextContent("Started until 03:00");
    expect(screen.queryByTestId("burst-start")).toBeNull();
  });

  it("without a time it says so and sends nothing", async () => {
    render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("burst-start"));
    expect(screen.getByTestId("burst-note")).toHaveTextContent("Choose the time: fill in hours and minutes (and AM/PM if the field shows it), or tap a length of time.");
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

  it("next to «Stop the team» the strip reads the settings itself, is the same control as everywhere, and shows nothing until it can", async () => {
    native.invoke.mockImplementation(async () => ({ ok: false, error: "team_settings_unavailable" }));
    const { container } = render(<BurstStrip />);
    await waitFor(() => expect(requests()).toEqual([{ op: "read" }]));
    expect(container).toBeEmptyDOMElement();
    cleanup();
    answer(() => reply());
    render(<BurstStrip />);
    expect(await screen.findByTestId("burst-start")).toHaveTextContent("Work at full throttle");
    expect(screen.getByText(BURST_TEXT.en.burstIntro)).toBeInTheDocument();
    expect(screen.getByText(BURST_TEXT.en.burstLimit)).toBeInTheDocument();
  });

  it("is written in the seven languages with the time slot intact", () => {
    for (const locale of Object.keys(BURST_TEXT) as Locale[]) {
      const text = BURST_TEXT[locale];
      for (const key of ["burstStart", "burstActive", "burstStarted"] as const) expect(text[key], `${locale} ${key}`).toContain("{time}");
      for (const [key, value] of Object.entries(text)) expect(value.trim(), `${locale} ${key}`).not.toBe("");
    }
  });
});

// ── a field that starts empty looks as if it had a value (WebKit shows 12:30 PM in grey): it starts full, or with a length of time to tap ──
const ROME = { timezone: "Europe/Rome", windows: [{ days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "18:00" }] };
const NOON_UTC = new Date("2026-11-02T12:07:00Z"); // 13:07 in Rome (CET)

describe("the time the field starts on, and the lengths of time to tap", () => {
  it("reads the clock of the zone it is given, not the computer's", () => {
    expect(clockIn("Europe/Rome", NOON_UTC)).toBe("13:07");
    expect(clockIn("Asia/Tokyo", NOON_UTC)).toBe("21:07");
    expect(clockIn("America/New_York", NOON_UTC)).toBe("07:07");
    expect(clockIn("Not/AZone", NOON_UTC)).toBeNull();
    expect(clockIn(null, NOON_UTC)).toBeNull();
    expect(clockIn("Europe/Rome", new Date("2026-11-02T22:59:00Z"))).toBe("23:59");
    expect(clockIn("Europe/Rome", new Date("2026-11-02T23:00:00Z"))).toBe("00:00");
  });

  it("starts the field four hours from now, rounded up to a quarter of an hour, in the team's zone, inside the 12 hours", () => {
    expect(DEFAULT_HOURS).toBe(4);
    expect(untilIn("Europe/Rome", DEFAULT_HOURS, NOON_UTC, "quarter")).toBe("17:15");
    expect(untilIn("Europe/Rome", 4, new Date("2026-11-02T12:15:00Z"), "quarter")).toBe("17:15");
    expect(untilIn("Europe/Rome", 4, new Date("2026-11-02T20:50:00Z"), "quarter")).toBe("02:00");
    expect(untilIn("Europe/Rome", 1, NOON_UTC, "minute")).toBe("14:07");
    expect(untilIn("Europe/Rome", 1, new Date("2026-11-02T12:07:30Z"), "minute")).toBe("14:08");
    expect(untilIn(null, 4, NOON_UTC, "quarter")).toBeNull();
    for (const hours of [...QUICK_HOURS, DEFAULT_HOURS]) expect(hours).toBeLessThanOrEqual(12);
  });

  it("shows the field already full when the team's zone is known, and the button says the time", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOON_UTC });
    try {
      answer(() => reply({ working_hours: ROME, burst: { active: false } }));
      render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
      const field = (await screen.findByTestId("burst-time")) as HTMLInputElement;
      expect(field.value).toBe("17:15");
      expect(screen.getByTestId("burst-start")).toHaveTextContent("Work at full throttle until 17:15");
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts with the value in the field when the person only presses the button", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOON_UTC });
    try {
      answer((request) => (request.op === "burst_start" ? reply({ working_hours: ROME, burst: { active: true, until: IN_AN_HOUR(), untilLocal: "17:15" } }) : reply({ working_hours: ROME })));
      render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
      const user = userEvent.setup({ advanceTimers: () => undefined });
      await user.click(await screen.findByTestId("burst-start"));
      expect(await screen.findByTestId("burst-active")).toHaveTextContent("Full throttle until 17:15");
      expect(requests().at(-1)).toEqual({ op: "burst_start", until: "17:15", connectionKey: KEY });
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers one tap for 1, 2 and 4 hours, and a tap sends the team's clock time that far from now", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOON_UTC });
    try {
      answer((request) => (request.op === "burst_start" ? reply({ working_hours: ROME, burst: { active: true, until: IN_AN_HOUR(), untilLocal: "15:07" } }) : reply({ working_hours: ROME })));
      render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
      const user = userEvent.setup({ advanceTimers: () => undefined });
      const group = await screen.findByTestId("burst-quick");
      expect(group).toHaveTextContent("For how long?");
      expect([1, 2, 4].map((h) => screen.getByTestId(`burst-quick-${h}`).textContent)).toEqual(["for 1 hour", "for 2 hours", "for 4 hours"]);
      expect(screen.getByLabelText("Or an exact time")).toBe(screen.getByTestId("burst-time"));
      await user.click(screen.getByTestId("burst-quick-2"));
      expect(await screen.findByTestId("burst-active")).toHaveTextContent("Full throttle until 15:07");
      expect(requests().at(-1)).toEqual({ op: "burst_start", until: "15:07", connectionKey: KEY });
    } finally {
      vi.useRealTimers();
    }
  });

  it("with no zone known it guesses nothing: the field stays empty, no length of time is offered, and the message says what is missing", async () => {
    answer(() => reply({ working_hours: null }));
    render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
    const user = userEvent.setup();
    const field = (await screen.findByTestId("burst-time")) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(screen.queryByTestId("burst-quick")).toBeNull();
    await user.click(screen.getByTestId("burst-start"));
    expect(screen.getByTestId("burst-note")).toHaveTextContent(/hours and minutes/);
    expect(requests().map((r) => r.op)).toEqual(["read"]);
  });

  it("a field the person has emptied again says what is missing and sends nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOON_UTC });
    try {
      answer(() => reply({ working_hours: ROME }));
      render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
      const user = userEvent.setup({ advanceTimers: () => undefined });
      await user.clear(await screen.findByTestId("burst-time"));
      await user.click(screen.getByTestId("burst-start"));
      expect(screen.getByTestId("burst-note")).toHaveTextContent("fill in hours and minutes (and AM/PM if the field shows it)");
      expect(requests().map((r) => r.op)).toEqual(["read"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the new lines exist in the seven languages", () => {
    const keys = ["burstNeedsTime", "burstQuickLabel", "burstFor1", "burstFor2", "burstFor4", "burstExactLabel", "burstUndo"] as const;
    for (const locale of Object.keys(BURST_TEXT) as Locale[]) for (const key of keys) expect(BURST_TEXT[locale][key]?.length, `${locale}/${key}`).toBeGreaterThan(3);
  });
});

// ── a one-tap start can be taken back: «Started until HH:MM, Undo» for ten seconds, and the strip with «Stop now» stays while it lasts ──
describe("taking back a one-tap start", () => {
  const startsOn = (untilLocal: string) =>
    answer((request) => (request.op === "burst_start" ? reply({ working_hours: ROME, burst: { active: true, until: IN_AN_HOUR(), untilLocal } }) : reply({ working_hours: ROME })));

  it("a tap on 2 hours shows «Started until 15:07» with «Undo», and the strip with «Stop now» is there too", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOON_UTC });
    try {
      startsOn("15:07");
      render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
      const user = userEvent.setup({ advanceTimers: () => undefined });
      await user.click(await screen.findByTestId("burst-quick-2"));
      const undo = await screen.findByTestId("burst-undo");
      expect(undo).toHaveTextContent("Started until 15:07");
      expect(screen.getByTestId("burst-undo-button")).toHaveTextContent("Undo");
      expect(screen.getByTestId("burst-active")).toHaveTextContent("Full throttle until 15:07");
      expect(screen.getByTestId("burst-stop")).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("«Undo» stops the burst with the key and the gesture comes back", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOON_UTC });
    try {
      answer((request) => {
        if (request.op === "burst_start") return reply({ working_hours: ROME, burst: { active: true, until: IN_AN_HOUR(), untilLocal: "14:07" } });
        if (request.op === "burst_stop") return reply({ working_hours: ROME, burst: { active: false } });
        return reply({ working_hours: ROME });
      });
      render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
      const user = userEvent.setup({ advanceTimers: () => undefined });
      await user.click(await screen.findByTestId("burst-quick-1"));
      await user.click(await screen.findByTestId("burst-undo-button"));
      expect(await screen.findByTestId("burst-start")).toBeInTheDocument();
      expect(requests().at(-1)).toEqual({ op: "burst_stop", connectionKey: KEY });
      expect(screen.queryByTestId("burst-undo")).toBeNull();
      expect(screen.getByTestId("burst-note")).toHaveTextContent("Stopped: the earlier hours are back.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the undo line goes after ten seconds and the strip with «Stop now» stays for as long as the burst lasts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOON_UTC });
    try {
      startsOn("15:07");
      const base = { target: "local" as const, connectionKey: KEY, workingHours: { timezone: "Europe/Rome", windows: [] }, roleModels: {} };
      const Host = () => {
        const [settings, setSettings] = React.useState<TeamSettings>(base);
        return <BurstControl settings={settings} onSettings={setSettings} />;
      };
      render(<Host />);
      await act(async () => {
        fireEvent.click(screen.getByTestId("burst-quick-2"));
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(screen.getByTestId("burst-undo")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UNDO_MS - 1000);
      });
      expect(screen.getByTestId("burst-undo")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.queryByTestId("burst-undo")).toBeNull();
      expect(screen.getByTestId("burst-active")).toHaveTextContent("Full throttle until 15:07");
      expect(screen.getByTestId("burst-stop")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a burst that was already running when the page opened shows the strip and no undo line", async () => {
    answer(() => reply({ working_hours: ROME, burst: running() }));
    render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByTestId("burst-active")).toBeInTheDocument();
    expect(screen.queryByTestId("burst-undo")).toBeNull();
  });

  it("a start the box refuses shows the refusal and no undo line", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOON_UTC });
    try {
      answer((request) => (request.op === "burst_start" ? { ok: false, error: "team_settings_burst_too_far" } : reply({ working_hours: ROME })));
      render(<WorkHoursPage params={{}} search={new URLSearchParams()} />);
      const user = userEvent.setup({ advanceTimers: () => undefined });
      await user.click(await screen.findByTestId("burst-quick-4"));
      expect(await screen.findByTestId("burst-note")).toHaveTextContent("more than 12 hours from now");
      expect(screen.queryByTestId("burst-undo")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
