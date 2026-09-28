import { describe, expect, it } from "vitest";
import { loadUsage, USAGE_SAMPLES, USAGE_SELECT } from "./load-usage";

type Call = { table: string; select?: string; eq?: [string, unknown]; order?: [string, unknown]; limit?: number };

const USER = "00000000-0000-4000-8000-000000000001";

/** A client that records the query and answers with the rows given; signed in as USER unless told otherwise. */
function client(rows: unknown[] | null, error: { message: string } | null = null, userId: string | null = USER) {
  const call: Call = { table: "" };
  const chain = {
    select(columns: string) {
      call.select = columns;
      return chain;
    },
    eq(column: string, value: unknown) {
      call.eq = [column, value];
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
    auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }) },
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
    // The user's own rows by an explicit filter, not by RLS alone (the house rule, as the profile page reads).
    expect(c.call).toEqual({ table: "sentinel_ticks", select: USAGE_SELECT, eq: ["user_id", USER], order: ["ts", { ascending: false }], limit: USAGE_SAMPLES });
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

  it("reads nothing without a session: there is no user to filter by", async () => {
    const c = client([], null, null);
    await expect(loadUsage(c as never)).rejects.toThrow("no session");
    expect(c.call.table).toBe("");
  });

  it("raises the cloud's error, so the page says it could not read", async () => {
    await expect(loadUsage(client(null, { message: "permission denied" }) as never)).rejects.toThrow("permission denied");
  });
});
