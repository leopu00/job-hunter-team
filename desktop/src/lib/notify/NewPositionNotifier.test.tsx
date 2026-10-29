import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../existing-team-readonly";
import { setLocalTeamData } from "../local-team-data";
import { writeNotifyPrefs } from "./prefs";

const w = vi.hoisted(() => ({ stopCloud: vi.fn(), stopVps: vi.fn() }));
vi.mock("./watch", () => ({
  watchCloudPositions: vi.fn(() => w.stopCloud),
  watchVpsPositions: vi.fn(() => w.stopVps),
}));
vi.mock("../supabase", () => ({ supabase: {} }));
vi.mock("../existing-team-positions", () => ({ readDesktopVpsNewestPositions: vi.fn() }));

import { watchCloudPositions, watchVpsPositions } from "./watch";
import { NewPositionNotifier } from "./NewPositionNotifier";

beforeEach(() => {
  localStorage.clear();
  vi.mocked(watchCloudPositions).mockClear();
  vi.mocked(watchVpsPositions).mockClear();
  w.stopCloud.mockClear();
  w.stopVps.mockClear();
});
afterEach(() => {
  act(() => leaveExistingTeamReadOnly());
  act(() => setLocalTeamData(null));
});

describe("NewPositionNotifier", () => {
  it("with the switch off nothing watches and nothing is read", () => {
    render(<NewPositionNotifier />);
    expect(watchCloudPositions).not.toHaveBeenCalled();
    expect(watchVpsPositions).not.toHaveBeenCalled();
  });

  it("turned on, watches the cloud; turned off, stops", () => {
    render(<NewPositionNotifier />);
    act(() => void writeNotifyPrefs({ enabled: true }));
    expect(watchCloudPositions).toHaveBeenCalledTimes(1);
    act(() => void writeNotifyPrefs({ enabled: false }));
    expect(w.stopCloud).toHaveBeenCalledTimes(1);
  });

  it("over an existing team's VPS it watches only while the view is open, and starts again on another connection", () => {
    writeNotifyPrefs({ enabled: true });
    act(() => enterExistingTeamReadOnly(true, null, "vps-a"));
    render(<NewPositionNotifier />);
    expect(watchVpsPositions).toHaveBeenCalledTimes(1);
    expect(watchCloudPositions).not.toHaveBeenCalled();
    // another connection: the old watch stops, a new one starts
    act(() => enterExistingTeamReadOnly(true, null, "vps-b"));
    expect(w.stopVps).toHaveBeenCalledTimes(1);
    expect(watchVpsPositions).toHaveBeenCalledTimes(2);
    // the view closes: no VPS watch is left
    act(() => leaveExistingTeamReadOnly());
    expect(w.stopVps).toHaveBeenCalledTimes(2);
  });

  it("a local profile watches this computer's team, never the cloud, and stops when it leaves", async () => {
    writeNotifyPrefs({ enabled: true });
    await act(async () => setLocalTeamData("local:abc"));
    render(<NewPositionNotifier />);
    expect(watchVpsPositions).toHaveBeenCalledTimes(1);
    expect(watchCloudPositions).not.toHaveBeenCalled();
    await act(async () => setLocalTeamData(null));
    expect(w.stopVps).toHaveBeenCalledTimes(1);
    expect(watchCloudPositions).toHaveBeenCalledTimes(1);
  });
});
