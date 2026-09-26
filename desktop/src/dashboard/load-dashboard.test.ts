import { describe, expect, it, vi } from "vitest";
import type { DashboardClient } from "../lib/dashboard-data";
import { fixturePosition, fixtureStats } from "./dashboard-fixture";
import { loadDashboard, newestScored, type DashboardSources } from "./load-dashboard";

const client = { from: vi.fn() } as unknown as DashboardClient;

function sources(over: Partial<DashboardSources> = {}): DashboardSources {
  return {
    stats: vi.fn().mockResolvedValue(fixtureStats),
    positions: vi.fn().mockResolvedValue([fixturePosition(1), fixturePosition(2)]),
    applicationEvents: vi.fn().mockResolvedValue([]),
    seenIds: vi.fn().mockResolvedValue(new Set(["pos-2"])),
    rates: vi.fn().mockResolvedValue({ EUR: 1 }),
    ...over,
  };
}

describe("loadDashboard", () => {
  it("reads every block through the signed-in client", async () => {
    const s = sources();
    const data = await loadDashboard(client, s);
    for (const read of [s.stats, s.positions, s.applicationEvents, s.seenIds]) {
      expect(read).toHaveBeenCalledWith(client);
    }
    expect(data.stats).toBe(fixtureStats);
    expect(data.rates).toEqual({ EUR: 1 });
  });

  it("marks as seen only the positions the user already opened", async () => {
    const data = await loadDashboard(client, sources());
    expect(data.positions.map((p) => [p.id, p.seen])).toEqual([
      ["pos-1", undefined],
      ["pos-2", true],
    ]);
  });
});

describe("newestScored", () => {
  it("keeps scored, non-excluded positions, newest score first, eight at most", () => {
    const rows = [
      fixturePosition(1, { scored_at: "2026-09-01T00:00:00Z" }),
      fixturePosition(2, { scored_at: "2026-09-03T00:00:00Z" }),
      fixturePosition(3, { status: "excluded", scored_at: "2026-09-09T00:00:00Z" }),
      fixturePosition(4, { score: null, scored_at: null }),
      fixturePosition(5, { scored_at: "2026-09-02T00:00:00Z" }),
    ];
    expect(newestScored(rows).map((p) => p.id)).toEqual(["pos-2", "pos-5", "pos-1"]);
    const many = Array.from({ length: 12 }, (_, i) => fixturePosition(i + 1));
    expect(newestScored(many)).toHaveLength(8);
  });
});
