import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardStats } from "../../../web/lib/types";
import { HEARTBEAT_MS, loadSnapshot, saveSnapshot } from "../lib/away-greeting";
import { AwayGreeting } from "./AwayGreeting";

// no cloud session, as in a local profile: the numbers come from the team, whatever the test environment says
vi.mock("./CloudDataNotice", () => ({ useCloudDataBlocked: () => true }));

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const KEY = "google:u1|team:local";

function stats(over: Partial<DashboardStats>): DashboardStats {
  return { total: 0, new: 0, checked: 0, scored: 0, writing: 0, review: 0, ready: 0, applied: 0, excluded: 0, response: 0, scored_open: 0, to_write: 0, ...over };
}
const NOW_STATS = stats({ total: 15, scored: 5, ready: 2 });

/** Mounts the strip with a fake clock and a fake reading; lets the first reading settle. */
async function mount(readStats: () => Promise<DashboardStats | null>, clock = { value: NOW }, identityKey = "google:u1") {
  const view = render(<AwayGreeting identityKey={identityKey} readStats={readStats} now={() => clock.value} locale="en" />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return view;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the greeting on coming back", () => {
  it("says nothing the first time and keeps the reading for the next", async () => {
    await mount(async () => NOW_STATS);
    expect(screen.queryByTestId("away-greeting")).toBeNull();
    expect(loadSnapshot(KEY)).toEqual({ at: NOW, counts: { total: 15, evaluated: 7, documents: 2 } });
  });

  it("says what the team did while the window was closed, with the links, and keeps the new reading", async () => {
    saveSnapshot(KEY, { at: NOW - 3 * 60 * MIN, counts: { total: 10, evaluated: 4, documents: 1 } });
    await mount(async () => NOW_STATS);
    const strip = screen.getByTestId("away-greeting");
    expect(strip).toHaveTextContent("While you were away: 5 new positions, 3 evaluated and 1 CV or letter ready.");
    expect(screen.getByRole("link", { name: "See the positions" })).toHaveAttribute("href", expect.stringContaining("/positions"));
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", expect.stringContaining("/dashboard"));
    expect(loadSnapshot(KEY)?.at).toBe(NOW);
    expect(loadSnapshot(KEY)?.counts).toEqual({ total: 15, evaluated: 7, documents: 2 });
  });

  it("is closed with a click and does not come back until the app is opened again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clock = { value: NOW };
    saveSnapshot(KEY, { at: NOW - 3 * 60 * MIN, counts: { total: 10, evaluated: 4, documents: 1 } });
    await mount(async () => NOW_STATS, clock);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("away-greeting")).toBeNull();
    clock.value += 2 * 60 * MIN;
    await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3); });
    expect(screen.queryByTestId("away-greeting")).toBeNull();
  });

  it("is closed by following one of its links", async () => {
    saveSnapshot(KEY, { at: NOW - 3 * 60 * MIN, counts: { total: 10, evaluated: 4, documents: 1 } });
    await mount(async () => NOW_STATS);
    await userEvent.click(screen.getByRole("link", { name: "See the positions" }));
    expect(screen.queryByTestId("away-greeting")).toBeNull();
  });

  it("says nothing after less than half an hour, or when nothing went up", async () => {
    saveSnapshot(KEY, { at: NOW - 20 * MIN, counts: { total: 10, evaluated: 4, documents: 1 } });
    await mount(async () => NOW_STATS);
    expect(screen.queryByTestId("away-greeting")).toBeNull();
    cleanup();
    saveSnapshot(KEY, { at: NOW - 3 * 60 * MIN, counts: { total: 15, evaluated: 7, documents: 2 } });
    await mount(async () => NOW_STATS);
    expect(screen.queryByTestId("away-greeting")).toBeNull();
  });

  it("says nothing and keeps the old reading when the numbers cannot be read or read as an empty team", async () => {
    const old = { at: NOW - 3 * 60 * MIN, counts: { total: 10, evaluated: 4, documents: 1 } };
    saveSnapshot(KEY, old);
    await mount(async () => null);
    expect(screen.queryByTestId("away-greeting")).toBeNull();
    expect(loadSnapshot(KEY)).toEqual(old);
    cleanup();
    await mount(async () => { throw new Error("offline"); });
    expect(loadSnapshot(KEY)).toEqual(old);
    cleanup();
    await mount(async () => stats({}));
    expect(screen.queryByTestId("away-greeting")).toBeNull();
    expect(loadSnapshot(KEY)).toEqual(old);
  });

  it("keeps a reading per person: another account's reading is not this one's", async () => {
    saveSnapshot("google:other|team:local", { at: NOW - 3 * 60 * MIN, counts: { total: 1, evaluated: 0, documents: 0 } });
    await mount(async () => NOW_STATS);
    expect(screen.queryByTestId("away-greeting")).toBeNull();
    expect(loadSnapshot(KEY)).not.toBeNull();
  });

  it("saves a fresh reading every few minutes while the app is open, so a closed window leaves a recent one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const clock = { value: NOW };
    const reads = vi.fn(async () => NOW_STATS);
    await mount(reads, clock);
    expect(reads).toHaveBeenCalledTimes(1);
    clock.value += HEARTBEAT_MS;
    await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS); });
    expect(reads.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(loadSnapshot(KEY)?.at).toBe(NOW + HEARTBEAT_MS);
  });

  it("saves the time the window was closed", async () => {
    const clock = { value: NOW };
    await mount(async () => NOW_STATS, clock);
    clock.value += 12 * MIN;
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(loadSnapshot(KEY)?.at).toBe(NOW + 12 * MIN);
  });

  it("has no frame, no form and nothing that loads from outside", async () => {
    saveSnapshot(KEY, { at: NOW - 3 * 60 * MIN, counts: { total: 10, evaluated: 4, documents: 1 } });
    const { container } = await mount(async () => NOW_STATS);
    expect(container.querySelectorAll("iframe,form,img,script,object,embed")).toHaveLength(0);
  });
});
