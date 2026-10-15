// Synthetic reply of the core's `stats` op (invented titles and companies; the
// repository is public). The shape is the one POSITIONS_READ_PY emits.
import type { DesktopVpsStats } from "../lib/existing-team-positions";
import { fixturePosition } from "../pages/dashboard/dashboard-fixture";

export function syntheticStats(over: Partial<DesktopVpsStats> = {}): DesktopVpsStats {
  const rows = Array.from({ length: 11 }, (_unused, index) =>
    fixturePosition(index + 1, {
      id: String(2000 + index),
      legacy_id: null,
      title: `Synthetic team role ${index + 1}`,
      role_family: index % 2 ? "Data" : "Operations",
      loc_country: index % 3 ? "AA" : "BB",
      loc_city: index % 3 ? "Alpha" : "Beta",
    }),
  );
  return {
    stats: {
      total: 12,
      new: 1,
      checked: 1,
      scored: 8,
      writing: 0,
      review: 0,
      ready: 0,
      applied: 2,
      excluded: 1,
      response: 0,
      scored_open: 8,
      to_write: 0,
    },
    distribution: {
      active: 11,
      withScore: 11,
      avgScore: 75,
      buckets: [
        { min: 76, max: 100, count: 5 },
        { min: 61, max: 75, count: 4 },
        { min: 41, max: 60, count: 2 },
        { min: 0, max: 40, count: 0 },
      ],
    },
    sources: [
      { source: "board-a", count: 7 },
      { source: "board-b", count: 4 },
    ],
    types: [
      { role_family: "Data", count: 5 },
      { role_family: "Operations", count: 6 },
    ],
    recent: [...rows].sort((a, b) => (b.scored_at ?? "").localeCompare(a.scored_at ?? "")).slice(0, 8),
    points: { rows, included: rows.length, of: rows.length },
    events: {
      rows: [
        { appliedAt: "2026-09-20T10:00:00Z", response: null, responseAt: null },
        { appliedAt: "2026-09-22T10:00:00Z", response: "interview", responseAt: "2026-09-24T10:00:00Z" },
      ],
      included: 2,
      of: 2,
    },
    ...over,
  };
}
