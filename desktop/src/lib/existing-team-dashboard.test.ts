import { describe, expect, it, vi } from "vitest";
import { syntheticStats } from "../test-support/existing-team-stats-fixture";
import { fixturePosition } from "../pages/dashboard/dashboard-fixture";
import {
  ExistingTeamDashboardError,
  loadExistingTeamDashboard,
  readLiveRates,
} from "./existing-team-dashboard";

const ok = (data = syntheticStats()) => vi.fn().mockResolvedValue({ source: "vps", data });

describe("loadExistingTeamDashboard", () => {
  it("builds the dashboard from the core's reply: counts, newest scored, charts rows, events", async () => {
    const stats = syntheticStats();
    const data = await loadExistingTeamDashboard({ stats: ok(stats), rates: async () => ({ EUR: 1, USD: 1.1 }) });
    expect(data.stats).toBe(stats.stats);
    expect(data.latest).toBe(stats.recent);
    expect(data.positions).toEqual(stats.points.rows);
    expect(data.applicationEvents).toEqual(stats.events.rows);
    expect(data.rates).toEqual({ EUR: 1, USD: 1.1 });
    expect(data.existingTeam).toMatchObject({
      active: 11, withScore: 11, avgScore: 75, chartsIncluded: 11, chartsOf: 11, eventsIncluded: 2, eventsOf: 2,
      ratesAvailable: true, salaryUnconverted: 0,
    });
  });

  it("leaves out a salary it cannot convert instead of reading it as euros", async () => {
    const rows = [
      fixturePosition(1, { salary_min: 50_000, salary_max: 60_000, salary_currency: "EUR" }),
      fixturePosition(2, { salary_min: 50_000, salary_max: 60_000, salary_currency: "USD" }),
      fixturePosition(3, { salary_min: null, salary_max: null, salary_currency: "USD" }),
    ];
    const stats = syntheticStats({ points: { rows, included: 3, of: 3 } });
    const data = await loadExistingTeamDashboard({ stats: ok(stats), rates: async () => null });
    expect(data.rates).toEqual({ EUR: 1 });
    expect(data.positions.map((p) => [p.salary_min, p.salary_max])).toEqual([[50_000, 60_000], [null, null], [null, null]]);
    expect(data.existingTeam).toMatchObject({ ratesAvailable: false, salaryUnconverted: 1 });
  });

  it("converts nothing and drops nothing when the rates are live", async () => {
    const rows = [fixturePosition(1, { salary_min: 50_000, salary_max: null, salary_currency: "USD" })];
    const data = await loadExistingTeamDashboard({
      stats: ok(syntheticStats({ points: { rows, included: 1, of: 1 } })),
      rates: async () => ({ EUR: 1, USD: 1.1 }),
    });
    expect(data.positions[0].salary_min).toBe(50_000);
    expect(data.existingTeam?.salaryUnconverted).toBe(0);
  });

  it("raises the core's own code when the reply is unavailable", async () => {
    const failure = vi.fn().mockResolvedValue({ source: "unavailable", code: "positions_unavailable" });
    await expect(loadExistingTeamDashboard({ stats: failure, rates: async () => null })).rejects.toMatchObject({
      name: "Error",
      code: "positions_unavailable",
    });
    await expect(loadExistingTeamDashboard({ stats: failure, rates: async () => null })).rejects.toBeInstanceOf(ExistingTeamDashboardError);
  });

  it("refuses to draw a dashboard when the app is not in the desktop", async () => {
    const outside = vi.fn().mockResolvedValue({ source: "not_desktop" });
    await expect(loadExistingTeamDashboard({ stats: outside, rates: async () => null })).rejects.toMatchObject({
      code: "runtime_data_unavailable",
    });
  });
});

describe("readLiveRates", () => {
  it("reads the live rates, with the euro", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rates: { USD: 1.1 } }), { status: 200 }));
    await expect(readLiveRates(fetchImpl as unknown as typeof fetch)).resolves.toEqual({ EUR: 1, USD: 1.1 });
  });

  it.each([
    ["an error status", () => new Response("", { status: 503 })],
    ["a reply without rates", () => new Response(JSON.stringify({}), { status: 200 })],
    ["an unreadable reply", () => new Response("not json", { status: 200 })],
  ])("answers none for %s: the web's built-in table is not a rate", async (_name, make) => {
    const fetchImpl = vi.fn().mockResolvedValue(make());
    await expect(readLiveRates(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("answers none when the network is down or too slow", async () => {
    await expect(readLiveRates(vi.fn().mockRejectedValue(new TypeError("down")) as unknown as typeof fetch)).resolves.toBeNull();
    const never = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    await expect(readLiveRates(never as unknown as typeof fetch, 5)).resolves.toBeNull();
  });
});
