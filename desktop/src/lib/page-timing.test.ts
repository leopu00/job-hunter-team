import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

import { beginPageLoad, cloudLabel, dataShown, nativeReadStarted, pageOfPath, setPageTimingClock, type PageDataSource } from "./page-timing";

let now = 0;
const metrics = () => native.invoke.mock.calls.filter(([command]) => command === "page_load_metric").map(([, args]) => args.metric);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("PerformanceObserver", undefined);
  now = 1000;
  setPageTimingClock(() => now);
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.isTauri.mockReturnValue(true);
});
afterEach(() => {
  beginPageLoad("");
  setPageTimingClock(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function read(start: number, end: number, worked = true) {
  now = start;
  const ended = nativeReadStarted();
  now = end;
  ended(worked);
}

const routes = [
  ["/dashboard", "dashboard"], ["/map", "map"], ["/positions", "positions"],
  ["/positions/synthetic-id", "position"], ["/swipe", "swipe"], ["/team", "team"],
  ["/team/log", "team_log"], ["/team/scout", "team_scout"], ["/team/analista", "team_analista"],
  ["/team/scorer", "team_scorer"], ["/team/scrittore", "team_scrittore"], ["/team/critico", "team_critico"],
  ["/messages", "messages"], ["/profile", "profile"], ["/agents", "agents"],
  ["/agents/synthetic-agent", "agent"], ["/office", "office"], ["/mail", "mail"],
  ["/budget", "budget"], ["/settings/synthetic-section", "settings"], ["/help", "help"],
] as const;

it.each(routes)("records %s by the closed key %s, even without a read", async (path, page) => {
  expect(pageOfPath(path)).toBe(page);
  beginPageLoad(path);
  now = 1050;
  dataShown("memory");
  await vi.advanceTimersByTimeAsync(800);
  expect(metrics()).toEqual([{
    page, firstDataMs: 50, firstDataSource: "memory", completeMs: 50,
    nativeReads: 0, nativeMs: 0, cloud: [],
  }]);
  expect(JSON.stringify(metrics())).not.toContain("synthetic");
});

it("accepts the router's trailing slash and rejects unregistered routes or malformed parameters", () => {
  expect(pageOfPath("/positions/42/")).toBe("position");
  for (const path of ["/", "", "/positions/42/edit", "/unknown", "/agents/%ZZ"]) expect(pageOfPath(path)).toBeNull();
});

it.each(["memory", "stream", "native", "cloud"] as const)("takes the first visible data from %s", async (source) => {
  beginPageLoad("/dashboard");
  now = 1010;
  dataShown(source);
  now = 1060;
  dataShown("cloud");
  await vi.advanceTimersByTimeAsync(800);
  expect(metrics()[0]).toMatchObject({ firstDataMs: 10, firstDataSource: source, completeMs: 60 });
});

describe("native work and the first committed data", () => {
  it("does not confuse a completed read with data that is shown later", async () => {
    beginPageLoad("/map");
    read(1100, 1900);
    await vi.advanceTimersByTimeAsync(1000);
    expect(metrics()).toEqual([]);
    now = 2300;
    dataShown("native");
    read(2400, 2600);
    await vi.advanceTimersByTimeAsync(799);
    expect(metrics()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(metrics()).toEqual([{
      page: "map", firstDataMs: 1300, firstDataSource: "native", completeMs: 1600,
      nativeReads: 2, nativeMs: 1000, cloud: [],
    }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(metrics()).toHaveLength(1);
  });

  it("waits for native work while keeping the first memory result", async () => {
    beginPageLoad("/positions");
    now = 1050;
    dataShown("memory");
    read(1050, 1200, false);
    now = 1300;
    const ended = nativeReadStarted();
    await vi.advanceTimersByTimeAsync(5000);
    expect(metrics()).toEqual([]);
    now = 6000;
    ended(true);
    ended(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(metrics()).toEqual([{
      page: "positions", firstDataMs: 50, firstDataSource: "memory", completeMs: 5000,
      nativeReads: 2, nativeMs: 4850, cloud: [],
    }]);
  });

  it("never reports a failed read or an unrendered successful read as first data", () => {
    beginPageLoad("/positions");
    read(1100, 1200, false);
    read(1300, 1400, true);
    beginPageLoad("");
    expect(metrics()[0]).toMatchObject({ firstDataMs: null, firstDataSource: null, nativeReads: 2 });
  });
});

it("records pages left without reads or data with a missing first data, not a false zero", () => {
  const close = beginPageLoad("/messages");
  now = 1400;
  close();
  close();
  expect(metrics()).toEqual([{
    page: "messages", firstDataMs: null, firstDataSource: null, completeMs: 400,
    nativeReads: 0, nativeMs: 0, cloud: [],
  }]);
});

it("a stale read and old cleanup cannot close or change the next page", async () => {
  const closeOld = beginPageLoad("/map");
  const oldRead = nativeReadStarted();
  now = 2000;
  beginPageLoad("/agents/synthetic-agent");
  oldRead(true);
  closeOld();
  now = 2025;
  dataShown("stream");
  await vi.advanceTimersByTimeAsync(800);
  expect(metrics()).toHaveLength(2);
  expect(metrics()[0]).toMatchObject({ page: "map", firstDataMs: null });
  expect(metrics()[1]).toMatchObject({ page: "agent", firstDataMs: 25, firstDataSource: "stream", nativeReads: 0 });
});

it("ends a never-ready page at a hard deadline even without native work", async () => {
  beginPageLoad("/budget");
  now = 61_000;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(metrics()[0]).toMatchObject({ page: "budget", firstDataMs: null, firstDataSource: null, completeMs: 60_000 });
  dataShown("native");
  expect(metrics()).toHaveLength(1);
});

it("ends an in-flight read at the deadline and keeps the displayed data", async () => {
  beginPageLoad("/positions");
  now = 1050;
  dataShown("memory");
  const ended = nativeReadStarted();
  now = 61_000;
  await vi.advanceTimersByTimeAsync(60_000);
  ended(true);
  expect(metrics()).toHaveLength(1);
  expect(metrics()[0]).toMatchObject({ firstDataMs: 50, firstDataSource: "memory", completeMs: 60_000, nativeReads: 0 });
});

it("records cloud work but first data only when the cloud result is shown", async () => {
  let deliver: (entries: PerformanceResourceTiming[]) => void = () => undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("PerformanceObserver", class {
    constructor(callback: PerformanceObserverCallback) {
      deliver = (entries) => callback({ getEntries: () => entries } as unknown as PerformanceObserverEntryList, this as unknown as PerformanceObserver);
    }
    observe() {}
    disconnect = disconnect;
  });
  beginPageLoad("/profile");
  deliver([{
    name: "https://project.example.invalid/rest/v1/position_views?secret=synthetic-value",
    startTime: 1050, responseEnd: 1300, duration: 250, initiatorType: "fetch",
  } as PerformanceResourceTiming]);
  await vi.advanceTimersByTimeAsync(1200);
  expect(metrics()).toEqual([]);
  now = 1450;
  dataShown("cloud");
  await vi.advanceTimersByTimeAsync(800);
  expect(metrics()).toEqual([{
    page: "profile", firstDataMs: 450, firstDataSource: "cloud", completeMs: 450,
    nativeReads: 0, nativeMs: 0, cloud: [{ label: "position_views", ms: 250 }],
  }]);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it("ignores browser-only and unknown routes and non-allowlisted data sources", async () => {
  native.isTauri.mockReturnValue(false);
  beginPageLoad("/map");
  dataShown("native");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(metrics()).toEqual([]);
  native.isTauri.mockReturnValue(true);
  beginPageLoad("/unknown");
  dataShown("memory");
  expect(metrics()).toEqual([]);
  beginPageLoad("/map");
  dataShown("synthetic-private-source" as PageDataSource);
  beginPageLoad("");
  expect(metrics()[0]).toMatchObject({ firstDataMs: null, firstDataSource: null });
});

it("names cloud calls by table or rates, without their address", () => {
  expect(cloudLabel("https://project.example.invalid/rest/v1/position_views?select=position_id")).toBe("position_views");
  expect(cloudLabel("https://api.frankfurter.dev/v1/latest?base=EUR")).toBe("rates");
  for (const url of ["https://project.example.invalid/auth/v1/token", "https://project.example.invalid/rest/v1/Bad-Name", "not a url"]) {
    expect(cloudLabel(url)).toBe("other");
  }
});
