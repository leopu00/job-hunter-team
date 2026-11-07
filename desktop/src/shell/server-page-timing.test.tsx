import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);
import * as timing from "../lib/page-timing";
import { forgetReadsInFlight } from "../lib/read-deadline";
import { registerAuthStorageProbe } from "../lib/auth-storage-lock";
import { setLocalTeamData } from "../lib/local-team-data";
import { navigate, refresh } from "./router";
import { PageTimingBoundary } from "./PageTimingBoundary";
import ServerPage from "./server-page";

let now = 1000;
const metrics = () => native.invoke.mock.calls.filter(([name]) => name === "page_load_metric").map(([, args]) => args.metric);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("PerformanceObserver", undefined);
  native.invoke.mockReset().mockResolvedValue(undefined);
  forgetReadsInFlight();
  registerAuthStorageProbe(() => true);
  setLocalTeamData(null);
  now = 1000;
  timing.setPageTimingClock(() => now);
  navigate("/map", { replace: true, scroll: false });
});
afterEach(() => {
  cleanup();
  timing.beginPageLoad("");
  timing.setPageTimingClock(null);
  setLocalTeamData(null);
  registerAuthStorageProbe(() => true);
  forgetReadsInFlight();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function page(load: () => Promise<ReactNode> | ReactNode, runKey = "initial", path = "/map") {
  return <PageTimingBoundary path={path} search="">
    <ServerPage render={load} runKey={runKey} fallback={<p>synthetic skeleton</p>} />
  </PageTimingBoundary>;
}

it.each([false, true])("signals committed ready data once for localTeam=%s", async (local) => {
  if (local) setLocalTeamData("synthetic-local-team");
  let answer!: (node: ReactNode) => void;
  const realShown = timing.dataShown;
  const visible: boolean[] = [];
  const shown = vi.spyOn(timing, "dataShown").mockImplementation((source) => {
    visible.push(screen.queryByText("synthetic ready") !== null);
    realShown(source);
  });
  render(page(() => new Promise<ReactNode>((resolve) => { answer = resolve; })));
  await act(async () => undefined);
  expect(shown).not.toHaveBeenCalled();
  now = 1050;
  await act(async () => answer(<p>synthetic ready</p>));
  expect(visible).toEqual([true]);
  expect(shown).toHaveBeenCalledExactlyOnceWith(local ? "native" : "cloud");
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(metrics()).toHaveLength(1);
  expect(metrics()[0]).toMatchObject({ page: "map", firstDataMs: 50, firstDataSource: local ? "native" : "cloud" });
});

it("a failed run emits a null first datum when the page is left", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const shown = vi.spyOn(timing, "dataShown");
  const view = render(page(() => Promise.reject(new Error("synthetic offline"))));
  await act(async () => undefined);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(shown).not.toHaveBeenCalled();
  now = 1200;
  view.unmount();
  expect(metrics()).toHaveLength(1);
  expect(metrics()[0]).toMatchObject({ firstDataMs: null, firstDataSource: null });
});

it("refresh after ready does not move or signal the first datum again", async () => {
  const load = vi.fn().mockResolvedValueOnce(<p>synthetic first</p>).mockResolvedValueOnce(<p>synthetic refreshed</p>);
  const shown = vi.spyOn(timing, "dataShown");
  render(page(load));
  await act(async () => undefined);
  expect(screen.getByText("synthetic first")).toBeInTheDocument();
  expect(shown).toHaveBeenCalledTimes(1);
  now = 1400;
  await act(async () => refresh());
  expect(screen.getByText("synthetic refreshed")).toBeInTheDocument();
  expect(shown).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(metrics()).toHaveLength(1);
  expect(metrics()[0]).toMatchObject({ firstDataMs: 0, firstDataSource: "cloud" });
});

it("a response from an older run cannot report or replace the current result", async () => {
  let oldAnswer!: (node: ReactNode) => void;
  let newAnswer!: (node: ReactNode) => void;
  const shown = vi.spyOn(timing, "dataShown");
  const view = render(page(() => new Promise<ReactNode>((resolve) => { oldAnswer = resolve; }), "old"));
  await act(async () => undefined);
  view.rerender(page(() => new Promise<ReactNode>((resolve) => { newAnswer = resolve; }), "new"));
  await act(async () => undefined);
  await act(async () => oldAnswer(<p>synthetic obsolete</p>));
  expect(screen.queryByText("synthetic obsolete")).not.toBeInTheDocument();
  expect(shown).not.toHaveBeenCalled();
  now = 1100;
  await act(async () => newAnswer(<p>synthetic current</p>));
  expect(screen.getByText("synthetic current")).toBeInTheDocument();
  expect(shown).toHaveBeenCalledTimes(1);
});

it("a pending refresh cannot report into another page after unmount", async () => {
  let answer!: (node: ReactNode) => void;
  const load = vi.fn().mockResolvedValueOnce(<p>synthetic first</p>)
    .mockImplementationOnce(() => new Promise<ReactNode>((resolve) => { answer = resolve; }));
  const shown = vi.spyOn(timing, "dataShown");
  const old = render(page(load));
  await act(async () => undefined);
  await act(async () => refresh());
  old.unmount();
  navigate("/positions", { replace: true, scroll: false });
  const next = render(page(() => new Promise<ReactNode>(() => undefined), "next", "/positions"));
  await act(async () => undefined);
  await act(async () => answer(<p>synthetic obsolete refresh</p>));
  expect(screen.queryByText("synthetic obsolete refresh")).not.toBeInTheDocument();
  expect(shown).toHaveBeenCalledTimes(1);
  next.unmount();
  expect(metrics()).toHaveLength(2);
  expect(metrics()[1]).toMatchObject({ page: "positions", firstDataMs: null, firstDataSource: null });
});

it("a ready result hidden by the cloud notice is not visible data", async () => {
  registerAuthStorageProbe(() => false);
  const shown = vi.spyOn(timing, "dataShown");
  const view = render(page(() => <p>synthetic hidden</p>));
  await act(async () => undefined);
  expect(screen.queryByText("synthetic hidden")).not.toBeInTheDocument();
  expect(shown).not.toHaveBeenCalled();
  view.unmount();
  expect(metrics()[0]).toMatchObject({ firstDataMs: null, firstDataSource: null });
});

it("a failed page can retry and signals only the successful committed result", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const load = vi.fn().mockRejectedValueOnce(new Error("synthetic offline"))
    .mockResolvedValueOnce(<p>synthetic retry succeeded</p>);
  const shown = vi.spyOn(timing, "dataShown");
  render(page(load));
  await act(async () => undefined);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(shown).not.toHaveBeenCalled();
  now = 1200;
  await act(async () => screen.getByRole("button", { name: "Riprova" }).click());
  expect(screen.getByText("synthetic retry succeeded")).toBeInTheDocument();
  expect(shown).toHaveBeenCalledExactlyOnceWith("cloud");
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(metrics()).toHaveLength(1);
  expect(metrics()[0]).toMatchObject({ firstDataMs: 200, firstDataSource: "cloud" });
});
