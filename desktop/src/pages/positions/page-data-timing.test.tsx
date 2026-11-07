import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), cloud: false, cascade: false }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@/app/(protected)/positions/page", async () => {
  const { readDesktopVpsPositions } = await import("../../web-shims/server/desktop-vps-positions");
  return { default: async ({ searchParams }: { searchParams: Promise<{ q?: string }> }) => {
    if (native.cloud) return <p>synthetic cloud ready</p>;
    const { q } = await searchParams;
    const result = await readDesktopVpsPositions({ limit: 25, q });
    if (native.cascade) await readDesktopVpsPositions({ limit: 25, q: `${q}-followup` });
    if (result.source !== "vps") throw { code: "runtime_data_unavailable" };
    return <p>synthetic position ready: {result.data.length}</p>;
  } };
});

import PositionsPage from "./index";
import { PageTimingBoundary } from "../../shell/PageTimingBoundary";
import { navigate } from "../../shell/router";
import { setLocalTeamData } from "../../lib/local-team-data";
import { registerAuthStorageProbe } from "../../lib/auth-storage-lock";
import { forgetReadsInFlight } from "../../lib/read-deadline";
import { beginPageLoad, setPageTimingClock } from "../../lib/page-timing";

let now = 1000;
const metrics = () => native.invoke.mock.calls.filter(([name]) => name === "page_load_metric")
  .map(([, args]) => args.metric);
const page = (query = "") => <PageTimingBoundary path="/positions" search={query}>
  <PositionsPage params={{}} search={new URLSearchParams(query)} />
</PageTimingBoundary>;
const view = () => render(page());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("PerformanceObserver", undefined);
  native.invoke.mockReset().mockImplementation((command) => command === "existing_team_positions_read"
    ? new Promise((resolve) => setTimeout(() => resolve({ ok: true, data: { items: [{ id: "synthetic-a", title: "Synthetic role" }] } }), 1500))
    : Promise.resolve(undefined));
  native.cloud = false;
  native.cascade = false;
  forgetReadsInFlight();
  registerAuthStorageProbe(() => true);
  setLocalTeamData("synthetic-account-and-team");
  now = 1000;
  setPageTimingClock(() => now);
  navigate("/positions", { replace: true, scroll: false });
});

afterEach(() => {
  cleanup();
  beginPageLoad("");
  setPageTimingClock(null);
  setLocalTeamData(null);
  forgetReadsInFlight();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("page-timing measures first opening and return with a slow synthetic native reader", async () => {
  const first = view();
  await act(async () => undefined);
  expect(screen.queryByText("synthetic position ready: 1")).toBeNull();
  now = 2500;
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByText("synthetic position ready: 1")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  first.unmount();
  now = 3000;
  const again = view();
  await act(async () => undefined);
  const readyImmediately = screen.queryByText("synthetic position ready: 1") !== null;
  if (!readyImmediately) {
    now = 4500;
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  }
  if (readyImmediately) {
    now = 4500;
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  }
  expect(screen.getByText("synthetic position ready: 1")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  again.unmount();
  process.stdout.write("PAGE_DATA_TIMING " + JSON.stringify(metrics()) + "\n");
  expect(metrics()[0]).toMatchObject({ page: "positions", firstDataMs: 1500, firstDataSource: "native" });
  expect(metrics()[1].firstDataMs).toBeLessThan(200);
  expect(metrics()[1].firstDataSource).toBe("memory");
});

it("cloud data retains its cloud timing when no archive reader was used", async () => {
  native.cloud = true;
  setLocalTeamData(null);
  const opened = view();
  await act(async () => undefined);
  expect(screen.getByText("synthetic cloud ready")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  opened.unmount();
  expect(metrics()[0].firstDataSource).toBe("cloud");
  expect(native.invoke.mock.calls.filter(([name]) => name === "existing_team_positions_read")).toHaveLength(0);
});

it("a failed warm refresh keeps the copy and visible error without retrying itself", async () => {
  const first = view();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(screen.getByText("synthetic position ready: 1")).toBeInTheDocument();
  first.unmount();
  native.invoke.mockClear().mockImplementation((command) => command === "existing_team_positions_read"
    ? Promise.resolve({ ok: false, error: "positions_unavailable" }) : Promise.resolve(true));
  const again = view();
  await act(async () => undefined);
  expect(screen.getByText("synthetic position ready: 1")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("positions_unavailable");
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(native.invoke.mock.calls.filter(([name]) => name === "existing_team_positions_read")).toHaveLength(1);
  again.unmount();
});

it("a first read failure shows the error and cannot render a successful empty list", async () => {
  native.invoke.mockImplementation((command) => command === "existing_team_positions_read"
    ? Promise.resolve({ ok: false, error: "positions_unavailable" }) : Promise.resolve(true));
  view();
  await act(async () => undefined);
  expect(screen.queryByText(/synthetic position ready/)).toBeNull();
  expect(screen.getByTestId("page-data-notice")).toHaveTextContent("positions_unavailable");
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(native.invoke.mock.calls.filter(([name]) => name === "existing_team_positions_read")).toHaveLength(1);
});

it("a superseded slow filter cannot retry or start its followup in the new page", async () => {
  let finishOld!: (value: unknown) => void;
  native.cascade = true;
  native.invoke.mockImplementation((command, args) => command !== "existing_team_positions_read" ? Promise.resolve(true)
    : args.request.filters.q === "old" ? new Promise((resolve) => { finishOld = resolve; })
      : Promise.resolve({ ok: true, data: { items: [{ id: "synthetic-b", title: "Synthetic current" }] } }));
  navigate("/positions?q=old", { replace: true, scroll: false });
  const opened = render(page("q=old"));
  await act(async () => undefined);
  navigate("/positions?q=current", { replace: true, scroll: false });
  opened.rerender(page("q=current"));
  await act(async () => undefined);
  expect(screen.getByText("synthetic position ready: 1")).toBeInTheDocument();
  await act(async () => finishOld({ ok: true, data: { items: [{ id: "synthetic-a", title: "Synthetic old" }] } }));
  const queries = native.invoke.mock.calls.filter(([name]) => name === "existing_team_positions_read").map(([, args]) => args.request.filters.q);
  expect(queries.filter((q) => q === "old")).toHaveLength(1);
  expect(queries).not.toContain("old-followup");
  expect(queries).toContain("current-followup");
  expect(screen.queryByRole("alert")).toBeNull();
});
