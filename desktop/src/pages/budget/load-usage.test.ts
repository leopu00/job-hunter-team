import { describe, expect, it } from "vitest";
import { loadUsage, USAGE_SAMPLES, USAGE_SELECT } from "./load-usage";

type Call = { table: string; select?: string; order?: [string, unknown]; limit?: number };

/** A client that records the query and answers with the rows given. */
function client(rows: unknown[] | null, error: { message: string } | null = null) {
  const call: Call = { table: "" };
  const chain = {
    select(columns: string) {
      call.select = columns;
      return chain;
    },
    order(column: string, options: unknown) {
      call.order = [column, options];
      return chain;
    },
    limit(n: number) {
      call.limit = n;
      return Promise.resolve({ data: rows, error });
    },
  };
  return {
    call,
    from(table: string) {
      call.table = table;
      return chain;
    },
  };
}

describe("loadUsage", () => {
  it("reads the newest samples of sentinel_ticks, the bridge's columns", async () => {
    const c = client([]);
    await loadUsage(c as never);
    expect(c.call).toEqual({ table: "sentinel_ticks", select: USAGE_SELECT, order: ["ts", { ascending: false }], limit: USAGE_SAMPLES });
    for (const column of ["usage", "weekly_usage", "projection", "reset_at_unix", "status", "throttle"]) expect(USAGE_SELECT).toContain(column);
  });

  it("turns NUMERIC columns into numbers, whether they come as strings or numbers, and skips a row with no usage", async () => {
    const c = client([
      { ts: "2026-09-28T01:05:00Z", provider: "claude", usage: "37.5", weekly_usage: 62, projection: "81", velocity_smooth: null, status: "OK", throttle: 0, reset_at_unix: 1790566200, weekly_reset_at_unix: null },
      { ts: "2026-09-28T01:00:00Z", provider: "claude", usage: null, status: "OK" },
    ]);
    expect(await loadUsage(c as never)).toEqual([
      {
        ts: "2026-09-28T01:05:00Z",
        provider: "claude",
        usage: 37.5,
        weeklyUsage: 62,
        projection: 81,
        velocity: null,
        status: "OK",
        throttle: 0,
        resetAtUnix: 1790566200,
        weeklyResetAtUnix: null,
      },
    ]);
  });

  it("raises the cloud's error, so the page says it could not read", async () => {
    await expect(loadUsage(client(null, { message: "permission denied" }) as never)).rejects.toThrow("permission denied");
  });
});
