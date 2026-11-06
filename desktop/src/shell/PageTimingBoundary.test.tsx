import { StrictMode, useEffect, useLayoutEffect } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
import { beginPageLoad, dataShown, setPageTimingClock, type PageDataSource } from "../lib/page-timing";
import { PageTimingBoundary } from "./PageTimingBoundary";

let now = 1000;
const metrics = () => native.invoke.mock.calls.map(([, args]) => args.metric);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("PerformanceObserver", undefined);
  native.invoke.mockReset().mockResolvedValue(undefined);
  now = 1000;
  setPageTimingClock(() => now);
});
afterEach(() => {
  cleanup();
  beginPageLoad("");
  setPageTimingClock(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function LayoutData({ source }: { source: PageDataSource }) {
  useLayoutEffect(() => { now += 35; dataShown(source); }, [source]);
  return <p>synthetic visible result</p>;
}
function PassiveData({ label }: { label: string }) {
  useEffect(() => { now += 20; dataShown("cloud"); }, [label]);
  return <p>{label}</p>;
}

it("starts before data is committed by a child layout effect, including under StrictMode", async () => {
  render(<StrictMode><PageTimingBoundary path="/dashboard" search=""><LayoutData source="memory" /></PageTimingBoundary></StrictMode>);
  await vi.advanceTimersByTimeAsync(800);
  expect(metrics()).toHaveLength(1);
  expect(metrics()[0]).toMatchObject({ page: "dashboard", firstDataMs: 35, firstDataSource: "memory", nativeReads: 0 });
});

it("records a cloud result committed in a passive effect", async () => {
  render(<PageTimingBoundary path="/profile" search=""><PassiveData label="synthetic profile" /></PageTimingBoundary>);
  await vi.advanceTimersByTimeAsync(800);
  expect(metrics()[0]).toMatchObject({ page: "profile", firstDataMs: 20, firstDataSource: "cloud" });
});

it("closes the previous route and starts the next before its data effect", async () => {
  const view = render(<PageTimingBoundary path="/positions" search=""><PassiveData label="synthetic list" /></PageTimingBoundary>);
  now = 2000;
  view.rerender(<PageTimingBoundary path="/positions/synthetic-id" search=""><PassiveData label="synthetic detail" /></PageTimingBoundary>);
  expect(metrics()[0]).toMatchObject({ page: "positions", firstDataMs: 20 });
  await vi.advanceTimersByTimeAsync(800);
  expect(metrics()).toHaveLength(2);
  expect(metrics()[1]).toMatchObject({ page: "position", firstDataMs: 20, firstDataSource: "cloud" });
});

it("starts a new measurement on a query change even on the same route", async () => {
  const view = render(<PageTimingBoundary path="/positions" search="?page=1"><PassiveData label="synthetic first" /></PageTimingBoundary>);
  now = 2000;
  view.rerender(<PageTimingBoundary path="/positions" search="?page=2"><PassiveData label="synthetic second" /></PageTimingBoundary>);
  await vi.advanceTimersByTimeAsync(800);
  expect(metrics().map((m) => [m.page, m.firstDataMs])).toEqual([["positions", 20], ["positions", 20]]);
});

it("closes an unready page when the shell unmounts, without inventing data", () => {
  const view = render(<PageTimingBoundary path="/mail" search=""><p>synthetic skeleton</p></PageTimingBoundary>);
  now = 1250;
  view.unmount();
  expect(metrics()).toHaveLength(1);
  expect(metrics()[0]).toMatchObject({ page: "mail", firstDataMs: null, firstDataSource: null, completeMs: 250 });
});
