import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// How a page of a linked team is timed: the clock starts when the route changes, the first data is
// the first read of the team that worked, the last is the end of the last one before quiet.
// Synthetic clock; no network.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

import { beginPageLoad, cloudLabel, nativeReadStarted, pageOfPath, setPageTimingClock } from "./page-timing";

let now = 0;
const metrics = () => native.invoke.mock.calls.filter(([command]) => command === "page_load_metric").map(([, args]) => args.metric);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  now = 1000;
  setPageTimingClock(() => now);
  native.invoke.mockReset();
  native.invoke.mockResolvedValue(undefined);
  native.isTauri.mockReturnValue(true);
});
afterEach(() => {
  beginPageLoad("");
  setPageTimingClock(null);
  vi.useRealTimers();
});

const read = async (startAt: number, endAt: number, worked = true) => {
  now = startAt;
  const ended = nativeReadStarted();
  now = endAt;
  ended(worked);
};

describe("the page load timing", () => {
  it("knows the three pages and nothing else", () => {
    expect(["/map", "/positions", "/positions/42", "/positions/a1b2"].map(pageOfPath)).toEqual(["map", "positions", "position", "position"]);
    expect(["/", "/dashboard", "/positions/42/edit", "/messages", ""].map(pageOfPath)).toEqual([null, null, null, null, null]);
  });

  it("writes the first data, the last, the reads and their time, once, after 800 ms of quiet", async () => {
    beginPageLoad("/map");
    await read(1100, 1900);
    await read(1900, 2600);
    await vi.advanceTimersByTimeAsync(799);
    expect(metrics()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(metrics()).toEqual([{ page: "map", firstDataMs: 900, completeMs: 1600, nativeReads: 2, nativeMs: 1500, cloud: [] }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(metrics()).toHaveLength(1);
  });

  it("waits for a read still in flight, and a read that failed is not the first data", async () => {
    beginPageLoad("/positions");
    await read(1050, 1200, false);
    now = 1300;
    const ended = nativeReadStarted();
    await vi.advanceTimersByTimeAsync(5000);
    expect(metrics()).toEqual([]);
    now = 6000;
    ended(true);
    await vi.advanceTimersByTimeAsync(801);
    expect(metrics()).toEqual([{ page: "positions", firstDataMs: 5000, completeMs: 5000, nativeReads: 2, nativeMs: 4850, cloud: [] }]);
  });

  it("another route ends the page before it, and a page that read nothing writes nothing", async () => {
    beginPageLoad("/map");
    await read(1100, 1500);
    beginPageLoad("/positions/7");
    expect(metrics().map((m) => m.page)).toEqual(["map"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(metrics().map((m) => m.page)).toEqual(["map"]);
    beginPageLoad("/dashboard");
    await read(1, 2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(metrics()).toHaveLength(1);
  });

  it("times nothing outside the desktop app", async () => {
    native.isTauri.mockReturnValue(false);
    beginPageLoad("/map");
    await read(1100, 1500);
    await vi.advanceTimersByTimeAsync(2000);
    expect(metrics()).toEqual([]);
  });

  it("names a request to the cloud by its table or as the rates, never by its address", () => {
    expect(cloudLabel("https://project.example.invalid/rest/v1/position_views?select=position_id")).toBe("position_views");
    expect(cloudLabel("https://api.frankfurter.dev/v1/latest?base=EUR")).toBe("rates");
    expect(cloudLabel("https://project.example.invalid/auth/v1/token")).toBe("other");
    expect(cloudLabel("https://project.example.invalid/rest/v1/Bad-Name")).toBe("other");
    expect(cloudLabel("not a url")).toBe("other");
  });
});
