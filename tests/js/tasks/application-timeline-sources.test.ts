import { describe, expect, it, vi } from "vitest";

const localRows = [
  {
    applied_at: "2026-08-20T08:00:00Z",
    response: null,
    response_at: null,
  },
  {
    applied_at: "2026-08-21T08:00:00Z",
    response: "interview",
    response_at: "2026-08-23T10:00:00Z",
  },
  {
    applied_at: "2026-08-22T08:00:00Z",
    response: "rejected",
    response_at: "2026-08-24T10:00:00Z",
  },
];

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn((sql: string) => {
      expect(sql).toContain("SELECT applied_at, response, response_at");
      expect(sql).toContain("WHERE applied_at IS NOT NULL");
      expect(sql).toContain("ORDER BY applied_at ASC, id ASC");
      return { all: vi.fn(() => localRows) };
    }),
  })),
}));

const { getApplicationTimelineEventsLocal: getLocalEvents } =
  await import("@/lib/local-queries");
const { demoApplicationTimelineEvents } = await import("@/lib/demo/queries");

describe("fonti della timeline candidature", () => {
  it("SQLite conserva invio, esito canonico e data della risposta", () => {
    expect(getLocalEvents("/fake/workspace")).toEqual([
      {
        appliedAt: "2026-08-20T08:00:00Z",
        response: null,
        responseAt: null,
      },
      {
        appliedAt: "2026-08-21T08:00:00Z",
        response: "interview",
        responseAt: "2026-08-23T10:00:00Z",
      },
      {
        appliedAt: "2026-08-22T08:00:00Z",
        response: "rejected",
        responseAt: "2026-08-24T10:00:00Z",
      },
    ]);
  });

  it("il demo fornisce invii ed entrambi gli esiti senza valori inventati nel contratto", async () => {
    const events = await demoApplicationTimelineEvents("software");

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.appliedAt)).toBe(true);
    expect(events.some((event) => event.response === "interview")).toBe(true);
    expect(events.some((event) => event.response === "rejected")).toBe(true);
    expect(
      events.every(
        (event) =>
          event.response === null ||
          event.response === "interview" ||
          event.response === "rejected",
      ),
    ).toBe(true);
  });
});
